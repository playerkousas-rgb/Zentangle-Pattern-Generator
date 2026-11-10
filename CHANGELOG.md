# Changelog

本專案採用 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式，
版號跟 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [1.1.0] — 2026-11-10

依 `playerkousas-rgb/readme` 的規範（S／F／A／W／V／G11 及 repo 起手包）做全倉審查後的加固版。
完整審查報告：[`docs/REVIEW-2026-11-10.md`](docs/REVIEW-2026-11-10.md)。

### 新增
- **G11 九個圖標**：`public/icons/` 內 `favicon.ico`、16／32、apple-touch-icon、192／512、
  maskable 192／512 與 `og-image.png`（1200×630），全部 PNG／ICO，合計 142 KB ≤ 260 KB。
  母圖與建置腳本：`design/*.svg`、`scripts/build_icons.mjs`。
- **PWA manifest**（`public/manifest.webmanifest`，4 個 icon、standalone）與
  `robots.txt`、`sitemap.xml`。
- **SEO／分享中繼資料**：description、canonical、Open Graph、Twitter Card、
  JSON-LD（`WebApplication`）、`theme-color`、`app-version`、`copyright`。
- **`scripts/app_check_v1.0.mjs`**：一個命令驗 HTML 審計（S/F/A/W/V/C）、SEO、九個圖標、
  版號一致性、執行期依賴、dist 體積與死檔；`npm run audit` 即用。
- **CI**（`.github/workflows/ci.yml`）：check → lint → build → app_check → 體積預算，
  action 全部釘 commit SHA；另加 Dependabot 每週更新。
- **`LICENSE`**（版權保留 ＋ Zentangle® 商標聲明）、**`CHANGELOG.md`**、**`docs/`**。
- 匯出 PNG 寫入 `tEXt` 中繼資料（Copyright／Software／Source）：圖看不到分別，
  但檔案本身帶得走版權紀錄；列印頁加版權頁腳。

### 修正
- **網頁版分析改回零依賴**：移除 `@vercel/analytics` npm 套件（`dependencies` 回到 0 個，
  符合本倉「執行期依賴必須為 0」的規則），改用 Vercel 官方 snippet。
- **防呆**：生成流程加 `try/catch/finally`，任何錯誤都會收遮罩並提示，
  不會再卡死「處理中」；上傳限制 30 MB；圖片解碼失敗／圖案 SVG 缺失有提示。
- **可及性**：跳至主內容連結、`role="dialog" aria-modal` 與焦點管理、
  圖案／圖鑑格可鍵盤操作（Enter／Space）、滑桿與上傳區 aria-label、`focus-visible` 樣式。
- **SEO**：原本 3 個 `<h1>`（其中兩個在列印模板內）收成一個；列印模板改用 `.doc-title`。
- 移除死檔 `public/patterns/README.txt`、`public/favicon.svg`（G11 只准 PNG／ICO）。
- 依賴升級：`vite` 7.3.6 → 7.3.8（修掉 dev server 的 high 級 advisory）、
  `source-map-js` → 1.2.2。

### 已知限制
- 未實作 DCT 隱形水印（W2）：本工具輸出為圖案化作品，改用 PNG `tEXt` 中繼資料 ＋ 可見頁腳代替；
  可解碼的隱形水印仍待做（見審查報告「未做」一節）。
- Tailwind 仍用 CDN（刻意決策），生產環境 console 會有官方提示；改為建置期編譯需一次改完並視覺回歸。

## [1.0.0] — 2026-10

首個版本：上傳／拍照／貼上／拖放圖片、智能去背與分區、45 款禪繞圖案、
圖鑑與步驟教學、列印（A4／圖案表／方磚／Zendala／Bijou）、IndexedDB 作品集、Vercel 部署。
