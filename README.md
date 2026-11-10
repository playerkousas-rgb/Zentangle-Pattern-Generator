# 禪繞畫工具 — Zentangle Pattern Generator

> **English** — A single-page, **zero-runtime-dependency** web tool: upload a photo, it extracts the
> subject, segments the silhouette into smart regions, and fills each region with one of **45
> original Zentangle-style patterns**. Everything (background removal, region growing, tiling,
> export) runs **in your browser** — photos are never uploaded. Print-ready A4 / Zendala / Bijou
> sheets and a local gallery are built in.
>
> 🔗 https://zentangle-pattern-generator.vercel.app · 版本 **v1.1.0**

上傳一張圖片，自動提取主體、智能分區，並填入 45 款正統禪繞（Zentangle）圖案的**純前端**單頁工具。
所有運算（去背、分區、填圖案、匯出）都在你的瀏覽器完成，**圖片不會上傳到任何伺服器**。

- 🏷️ 目前版本：**v1.1.0**（2026-11-10 全倉審查後加固，見 [`docs/REVIEW-2026-11-10.md`](docs/REVIEW-2026-11-10.md)）
- 📦 執行期依賴：**0 個** · 建置產物：`dist/` ≈ **542 KB**
- 🧾 授權：版權保留（見 [`LICENSE`](LICENSE)）；Zentangle® 為 Rick Roberts 與 Maria Thomas 的註冊商標，本工具與其無隸屬關係

## 功能特色

- 🖼️ **上傳/拍照/貼上/拖放** 匯入圖片（PNG / JPG / WebP），手機可直接開相機；上限 30 MB
- 🧠 **智能主體提取**：自動去背（含透明 PNG 白邊處理）、泛洪背景偵測
- 🧩 **邊緣感知分區**（2–16 區）+ **Zendala 放射分區**，相鄰區域自動避免重複圖案
- 🎨 45 款內建圖案：密度、線條粗細、深淺節奏、特徵線強度皆可調
- 📖 圖案圖鑑：含 ⭐ 最愛（localStorage）與逐步驟教學（自動解析 SVG 筆畫）
- 🖨️ 列印：作品 A4、45 款圖案參考表、空白方磚 / Zendala 圓磚 / Bijou 小磚
- 💾 作品集相簿（IndexedDB 本地儲存，可放大預覽 / 下載 / 刪除）
- 📱 手機友善：底部固定工具列、安全區域（safe-area）支援
- 🔍 SEO／分享：canonical、Open Graph（1200×630 分享圖）、Twitter Card、JSON-LD
- 📲 PWA：manifest ＋ 9 個 PNG／ICO 圖標（含 maskable），可「加到主畫面」
- ♿ 可及性：鍵盤可操作圖案格、彈窗 focus 管理、跳至主內容、`aria-label`／`aria-pressed`

## 技術架構

```
index.html               ← 應用程式本體：全部 UI + 邏輯（Vanilla JS 單一 class）
public/patterns/         ← 45 款圖案 SVG（1.svg ~ 45.svg）+ blank.svg（程式以絕對路徑引用）
public/icons/            ← G11 九個圖標：favicon.ico / 16 / 32 / apple-touch / 192 / 512
                            + maskable 192 / 512 + og-image.png（1200×630）
public/manifest.webmanifest · public/robots.txt · public/sitemap.xml
design/                  ← 圖標母圖 SVG（唔會部署；由 scripts/build_icons.mjs 產出圖標）
scripts/                 ← 交付閘門（app_check）＋ 規範檢查器（HTML 審計 / SEO / repo_health）
                            ＋ 圖標建置
docs/                    ← 審查報告與決策紀錄（唔會部署）
.github/workflows/ci.yml ← PR 閘門：check → lint → build → app_check → 體積預算
vite.config.ts           ← 僅打包用（Vite 不做框架編譯）
vercel.json              ← Framework / Build / Output / 快取標頭
```

- **無後端、無資料庫**：IndexedDB / localStorage 全在使用者瀏覽器端
- **無任何前端框架**：不依賴 React/Vue；Tailwind 以 CDN 方式載入（刻意決策，見下方守則）
- **分析**：用 Vercel 官方零依賴 snippet `/_vercel/insights/script.js`，**不**裝 npm 套件
- 建置產物 = `dist/`（`index.html` + `public/` 複本，共約 0.53 MB）

## 開發指令

```bash
npm install        # 安裝開發依賴（只有 vite / typescript / eslint）
npm run dev        # 本機開發伺服器
npm run check      # TypeScript 型別檢查（tsc -b）
npm run lint       # ESLint（只覆蓋 .ts；inline JS 由 app_check 補驗）
npm run build      # 生產打包 → dist/（Vercel 部署的產物）
npm run preview    # 本機預覽建置結果

npm run audit      # ★ 交付前閘門：HTML 審計 + SEO + 圖標 + 版號 + 依賴 + 體積 + 死檔
npm run seo        # 只跑 SEO／GEO 靜態檢查
npm run verify     # check → lint → build → audit（CI 跑同一條）
npm run icons      # 由 design/*.svg 重新產生 9 個圖標（需先 npm i --no-save sharp）
```

### 交付前閘門（一個命令驗 10 組嘢）

```bash
npm run verify
```

`scripts/app_check_v1.0.mjs` 會驗：

1. 單一 HTML 審計（S／F／A／W／V／C）—— 抄自規範倉庫，標準一致
2. SEO／GEO（title／description／canonical／OG／JSON-LD／h1／alt／lang）
3. G11 九個圖標存在、尺寸正確、總和 ≤ 260 KB
4. manifest 4 個 icon、`og:image` 絕對網址且真檔為 1200×630
5. 版號四處一致（`APP_VERSION` ＝ meta ＝ `package.json` ＝ 頁尾）
6. 執行期依賴 = 0
7. `dist` ≤ 1 MB、`index.html` ≤ 5 MB
8. 無 `*.bak`／`*.tmp`／`*.old`／`*.log`／`(1).png` 死檔
9. inline JS 語法（補 ESLint 只驗 `.ts` 的盲點）
10. HTML 引用的 icon／manifest 都有實檔

> 唯一「已記錄例外」：**V1 檔名版號**。Vercel 靜態站入口必須叫 `index.html`，
> 不可以叫 `app_v1.1.0.html`；只要四處版號一致，閘門會降級做 INFO 並列印理由。

## 版號政策（V1／V2）

改版時**四處一齊改**，缺一會被 `npm run audit` 擋：

| 位置 | 現值 |
|---|---|
| `index.html` 內 `const APP_VERSION` | `v1.1.0` |
| `<meta name="app-version">` | `v1.1.0` |
| 頁尾 `<span id="appVersion">` | `v1.1.0`（由常數覆寫，防靜態漏改） |
| `package.json` `version` | `1.1.0` |
| `CHANGELOG.md` | 新增一節 |

## 圖標（G11）

- 九個檔全部 **PNG／ICO**，**不准** SVG／WebP／AVIF（iOS 主畫面、manifest、`favicon.ico`、WhatsApp 預覽各自只認一種）
- 母圖：`design/icon-master.svg`（全滿版、四色以上、主體置中約 60%）
- maskable：`design/icon-maskable.svg`（主體收在中央 66% 安全區）
- 16px：`design/favicon-16.svg`（另外手繪三層色，不是縮圖）
- 重新產生：`npm i --no-save sharp && npm run icons`（sharp 不加入 devDependencies，避免增肥）

## 私隱與版權

- **零上傳**：圖片只進入 canvas 記憶體；作品集存 IndexedDB；最愛存 localStorage
- **可見版權**：頁尾 `© SCOUT SYSTEM 2026`、`<meta name="copyright">`、列印頁腳
- **寫入檔案**：匯出的 PNG 會寫 `tEXt` 中繼資料（`Copyright`／`Software`／`Source`），
  圖看不出分別，但檔案本身帶得走版權紀錄
- **未做**：DCT 隱形水印（W2）—— 原因與補償寫在審查報告 §6.1
- **商標**：Zentangle® 為 Rick Roberts 與 Maria Thomas 的註冊商標；本工具為獨立創作，並無隸屬或授權關係

## 部署（Vercel）

- Framework：**Vite**｜Build：`npm run build`｜Output：`dist/`（已於 `vercel.json` 固化）
- `vercel.json` 另為圖標、`/patterns/*` 加上快取標頭
- Node 需求：≥ 20.19（Vite 7 要求，Vercel 預設即符合）
- CI 必須綠才合併；合併後開一次 Preview 與 Production，F12 Console 應 0 error

---

# 🛡️ 防增肥守則（Vercel 配額保護，改版前必讀）

> 2026-09 大瘦身後的鐵律。每次改版被破壞一次，Vercel 儲存/頻寬配額就離爆滿近一步。
> 2026-11 加固後再收緊一次：`dependencies` 已回到 **0 個**，勿再引入。

### 1. `.vercelignore` 是第一道防線
- 新增任何資料夾/檔案前，先問「**部署需要它嗎？**」不需要就加進 `.vercelignore`。
- 永不部署：`.git`、`node_modules`、`dist`、`*.bak`、`*.log`、`*.tmp`、`*.old`、`uploads/`、暫存檔、本機快取。
- 開發／審查用而**不部署**的：`scripts/`、`docs/`、`design/`、`.github/`、`README.md`、`CHANGELOG.md`、`LICENSE`。
- ⚠️ `.vercelignore` 一旦建立就**取代預設忽略規則**，所以 `.git`、`node_modules` 必須明確保留在清單內，勿刪。

### 2. 圖片與靜態資源
- `public/patterns/` 內的編號 SVG（`1.svg`–`45.svg`）與 `blank.svg` 被 `index.html` 以絕對路徑引用，**缺一不可**；新增圖案要同步改 `index.html` 內 `Array.from({ length: 45 })` 的數量與相關 UI 數字（46 / 45 處）。
- `public/icons/` 九個圖標合計 **≤ 260 KB**（現 142 KB），由 `npm run audit` 每次把關；只准減色，不准換格式。
- **禁止**把設計原稿、參考截圖、測試照片放進 `public/`。圖標母圖放 `design/`（已排除部署）。
- 新圖片進 `public/` 前必壓縮：SVG 用 SVGO，點陣圖考慮 WebP/AVIF，單檔儘量 < 100 KB。

### 3. 依賴極簡（`package.json`）
- **執行期依賴必須是 0 個**：本專案是純前端單檔應用，瀏覽器直接執行 `index.html`，`dependencies` 區塊應保持不存在或為空。
- **分析用官方 snippet**（`/_vercel/insights/script.js`），不要裝 `@vercel/analytics`；`app_check` 會擋。
- 其他套件只能進 `devDependencies`，並先評估能否以 CDN 或原生 API 取代。
- 歷史教訓：本倉庫曾殘留 React + react-router + framer-motion + lucide-react + Tailwind 編譯鏈（為一個從未接線的脚手架），讓 `node_modules` 達 **193 MB**、全部被打進 Vercel 快取 —— 已全數移除，勿復辟。
- Tailwind 目前刻意用 CDN（`cdn.tailwindcss.com`）以維持 100% 既有 UI；若未來要改為建置期編譯，請一次改完並完整視覺回歸測試，**不要兩套並存**（建議步驟見審查報告 §6.2）。

### 4. 死檔零容忍
- 刪功能時，連同它的圖片、CSS、孤立檔一起刪（用全域搜尋確認零引用）。
- 產出備份請用 Git Branch / Tag，**不要**在倉庫裡留 `*.bak`、`xxx_old.html`、`(1).png` 這類檔案。
- 上傳測試圖請放 `public/uploads/`（已被 git 與 Vercel 雙重忽略），測完即刪。

### 5. 每次交付前的守護流程（缺一不可）
```bash
npm run verify                                    # check + lint + build + audit，全綠才可提交
git status                                        # 確認沒有誤加大型檔案
du -sh public/icons public/patterns dist          # icons ≤ 260K、patterns ≈ 400K、dist ≈ 540K
```
- `dist/` 只應含 `index.html` + `public/` 複本（＋圖標、manifest）；若突然變大，就是有東西混進來了。
- CI（`.github/workflows/ci.yml`）跑同一條 `verify`，任何一項紅燈都不能合併。

## 文件

| 文件 | 內容 |
|---|---|
| [`docs/REVIEW-2026-11-10.md`](docs/REVIEW-2026-11-10.md) | v1.0.0 → v1.1.0 全倉審查：發現、修復、未做、建議 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本紀錄 |
| [`LICENSE`](LICENSE) | 版權保留與第三方聲明 |
