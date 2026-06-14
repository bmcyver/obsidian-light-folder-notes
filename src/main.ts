import {
  Plugin,
  TFolder,
  TFile,
  WorkspaceLeaf,
  PluginSettingTab,
  App,
  Setting,
} from 'obsidian';

interface FolderNoteSettings {
  defaultCreateExtension: string;
}

const DEFAULT_SETTINGS: FolderNoteSettings = {
  defaultCreateExtension: 'md',
};

const SUPPORTED_EXTENSIONS = ['base', 'md', 'canvas'];

export default class LightFolderNotePlugin extends Plugin {
  declare settings: FolderNoteSettings;
  private fileExplorerLeaves: WorkspaceLeaf[] = [];
  private observers: MutationObserver[] = [];

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new FolderNoteSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.bindObservers();
      this.registerEvent(
        this.app.workspace.on('layout-change', () => {
          this.bindObservers();
        }),
      );
    });

    this.registerDomEvent(activeDocument, 'click', this.onClick, {
      capture: true,
    });
  }

  onunload() {
    this.disconnectObservers();
  }

  async loadSettings() {
    const data = (await this.loadData()) as
      | Partial<FolderNoteSettings>
      | null
      | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private disconnectObservers() {
    for (const observer of this.observers) {
      observer.disconnect();
    }
    this.observers = [];
  }

  private bindObservers() {
    this.disconnectObservers();

    this.fileExplorerLeaves =
      this.app.workspace.getLeavesOfType('file-explorer');

    for (const leaf of this.fileExplorerLeaves) {
      const container = leaf.view.containerEl.querySelector(
        '.nav-files-container',
      );
      if (!container) continue;

      this.refreshFolderStyles(container as HTMLElement);

      const observer = new MutationObserver((mutations) => {
        let shouldRefresh = false;
        for (const mutation of mutations) {
          if (
            mutation.addedNodes.length > 0 ||
            mutation.removedNodes.length > 0
          ) {
            shouldRefresh = true;
            break;
          }
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'data-path'
          ) {
            shouldRefresh = true;
            break;
          }
        }

        if (shouldRefresh) {
          this.refreshFolderStyles(container as HTMLElement);
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-path'],
      });
      this.observers.push(observer);
    }
  }

  private onClick = (evt: MouseEvent) => {
    const target = evt.target as HTMLElement;
    const container = target.closest('.nav-files-container');
    if (!container) return;

    if (
      target.closest('.nav-folder-collapse-indicator') ||
      target.closest('.collapse-icon')
    )
      return;

    const titleEl = target.closest('.nav-folder-title');
    if (!titleEl) return;

    const path = titleEl.getAttribute('data-path');
    if (path == null) return;

    const folderPath = path === '/' ? '' : path;
    const folder = this.app.vault.getAbstractFileByPath(folderPath || '/');
    if (!(folder instanceof TFolder)) return;

    const noteFile = this.getFolderNoteFile(folder.path);

    if (noteFile) {
      evt.stopPropagation();
      evt.preventDefault();
      void this.openFolderNote(noteFile, evt.ctrlKey || evt.metaKey);
    } else if (evt.ctrlKey || evt.metaKey) {
      evt.stopPropagation();
      evt.preventDefault();
      void this.createNewFolderNote(folder.path);
    }
  };

  triggerStyleRefresh() {
    for (const leaf of this.fileExplorerLeaves) {
      const container = leaf.view.containerEl.querySelector(
        '.nav-files-container',
      );
      if (container) {
        this.refreshFolderStyles(container as HTMLElement);
      }
    }
  }

  private refreshFolderStyles(container: HTMLElement) {
    const fileElements = container.querySelectorAll('.nav-file');
    fileElements.forEach((el) => {
      const titleEl = el.querySelector(':scope > .nav-file-title');
      if (!titleEl) return;
      const path = titleEl.getAttribute('data-path');
      if (!path) return;

      const isNote = this.isFolderNotePath(path);
      const hasClass = el.classList.contains('fn-hidden-file');

      if (isNote && !hasClass) {
        el.classList.add('fn-hidden-file');
      } else if (!isNote && hasClass) {
        el.classList.remove('fn-hidden-file');
      }
    });

    const folderElements = container.querySelectorAll('.nav-folder');
    folderElements.forEach((el) => {
      const titleEl = el.querySelector(':scope > .nav-folder-title');
      if (!titleEl) return;

      let path = titleEl.getAttribute('data-path');
      if (path == null) return;
      path = path === '/' ? '' : path;

      const hasNote = this.getFolderNoteFile(path) !== null;
      const hasClass = titleEl.classList.contains('has-folder-note');

      if (hasNote && !hasClass) {
        titleEl.classList.add('has-folder-note');
      } else if (!hasNote && hasClass) {
        titleEl.classList.remove('has-folder-note');
      }
    });
  }

  private splitFileName(
    fileNameWithExt: string,
  ): { baseName: string; ext: string } | null {
    const lastDot = fileNameWithExt.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === fileNameWithExt.length - 1) return null;
    return {
      baseName: fileNameWithExt.slice(0, lastDot),
      ext: fileNameWithExt.slice(lastDot + 1),
    };
  }

  isFolderNotePath(filePath: string): boolean {
    const normalized = filePath.replace(/\/+$/, '');
    const parts = normalized.split('/');
    const fileNameWithExt = parts.pop() ?? '';
    const parentFolderName = parts.length > 0 ? parts[parts.length - 1] : '';

    const parsed = this.splitFileName(fileNameWithExt);
    if (!parsed) return false;

    const { baseName, ext } = parsed;
    return (
      parentFolderName !== '' &&
      baseName === parentFolderName &&
      SUPPORTED_EXTENSIONS.includes(ext)
    );
  }

  getFolderNoteFile(folderPath: string): TFile | null {
    const normalized = folderPath === '/' ? '' : folderPath;
    const folder = this.app.vault.getAbstractFileByPath(normalized || '/');
    if (!(folder instanceof TFolder)) return null;

    const folderName = folder.name;
    if (!normalized || folderName === '/') return null;

    const prefix = normalized ? `${normalized}/` : '';
    for (const ext of SUPPORTED_EXTENSIONS) {
      const potentialPath = `${prefix}${folderName}.${ext}`;
      const file = this.app.vault.getAbstractFileByPath(potentialPath);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  async createNewFolderNote(folderPath: string) {
    const normalized = folderPath === '/' ? '' : folderPath;
    const folder = this.app.vault.getAbstractFileByPath(normalized || '/');
    if (!(folder instanceof TFolder)) return;

    const folderName = folder.name;
    if (!normalized || folderName === '/') return;

    const defaultExt =
      this.settings.defaultCreateExtension || SUPPORTED_EXTENSIONS[0] || 'base';
    const prefix = normalized ? `${normalized}/` : '';
    const notePath = `${prefix}${folderName}.${defaultExt}`;

    const newFile = await this.app.vault.create(notePath, '');
    await this.openFolderNote(newFile, false);
    this.triggerStyleRefresh();
  }

  async openFolderNote(file: TFile, newLeaf: boolean) {
    const leaf = this.app.workspace.getLeaf(newLeaf);
    await leaf.openFile(file);
  }
}

class FolderNoteSettingTab extends PluginSettingTab {
  plugin: LightFolderNotePlugin;

  constructor(app: App, plugin: LightFolderNotePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Default create extension')
      .setDesc(
        'Select the default file extension used when creating a new folder note (Ctrl/Cmd + Click).',
      )
      .addDropdown((dropdown) => {
        SUPPORTED_EXTENSIONS.forEach((ext) => {
          dropdown.addOption(ext, `.${ext}`);
        });
        dropdown.setValue(this.plugin.settings.defaultCreateExtension);
        dropdown.onChange(async (value) => {
          this.plugin.settings.defaultCreateExtension = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
