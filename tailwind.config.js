/**
 * Tailwind 建置期設定（取代 cdn.tailwindcss.com 的 runtime JIT）
 *
 * 只掃 index.html：本 app 全部 class 都寫在同一個檔（含 JS template string），
 * 唔掃 node_modules／dist，保持輸出最細。
 * 改完 class 記得跑 `npm run css`；CI 會驗 public/tailwind.css 有冇過期。
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html'],
  theme: { extend: {} },
  plugins: [],
};
