import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// 本專案無 src/ 目錄：唯一的 TS 檔案是 vite.config.ts。
// 應用程式本體是 index.html 內的原生 JS（class ZentangleGenerator）。
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      // vite.config.ts 刻意以 @ts-ignore 動態匯入「正式環境不存在」的可選外掛
      // （.vite-source-tags.js），此為有意設計，停用該規則檢查。
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
])
