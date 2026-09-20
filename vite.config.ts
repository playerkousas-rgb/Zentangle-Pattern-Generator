import { defineConfig } from 'vite'

// 本專案為「單檔 Vanilla JS 應用」：index.html 內嵌全部邏輯與樣式，
// 不需要 React / Tailwind 編譯外掛，Vite 僅負責打包 index.html 與 public/ 靜態資源。
// https://vite.dev/config/
export default defineConfig(async () => {
  const plugins = [];
  try {
    // 開發環境（Arena）專用的來源標記外掛；檔案不存在於正式部署環境，
    // 因此刻意以 @ts-ignore + try/catch 載入，失敗時自動略過，不影響功能。
    // 注意：必須使用靜態字串路徑，該外掛存在時才會被正確納入。
    // @ts-ignore
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {
    // 可選外掛不存在：安全略過（no-empty 允許含註解的空區塊）
  }
  return {
    plugins,
    server: {
      host: true,
      allowedHosts: true as const,
    },
    preview: {
      host: true,
      allowedHosts: true as const,
    },
  };
})
