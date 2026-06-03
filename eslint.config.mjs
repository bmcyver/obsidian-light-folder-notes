import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig(
  obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
      },
    },
  },
  globalIgnores([
    "dist/**",
    "node_modules/**",
    "*.json",
    "*.mts",
    "*.mjs",
    "main.js",
  ]),
);
