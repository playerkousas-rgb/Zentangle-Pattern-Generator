# 禪繞畫工具 — Zentangle Pattern Generator

上傳一張圖片，自動提取主體、智能分區，並填入 45 款正統禪繞（Zentangle）圖案的**純前端**單頁工具。

## 功能特色

- 🖼️ **上傳/拍照/貼上/拖放** 匯入圖片（PNG / JPG / WebP），手機可直接開相機
- 🧠 **智能主體提取**：自動去背（含透明 PNG 白邊處理）、泛洪背景偵測
- 🧩 **邊緣感知分區**（2–16 區）+ **Zendala 放射分區**，相鄰區域自動避免重複圖案
- 🎨 45 款內建圖案：密度、線條粗細、深淺節奏、特徵線強度皆可調
- 📖 圖案圖鑑：含⭐最愛（localStorage）與逐步驟教學（自動解析 SVG 筆畫）
- 🖨️ 列印：作品 A4、45 款圖案參考表、空白方磚 / Zendala 圓磚 / Bijou 小磚
- 💾 作品集相簿（IndexedDB 本地儲存，可放大預覽 / 下載 / 刪除）
- 📱 手機友善：底部固定工具列、安全區域（safe-area）支援

## 技術架構

```
index.html          ← 應用程式本體：全部 UI + 邏輯（Vanilla JS 單一 class）
public/patterns/    ← 45 款圖案 SVG（1.svg ~ 45.svg）+ blank.svg（程式以絕對路徑引用）
public/favicon.svg  ← 網站圖示
vite.config.ts      ← 僅打包用（Vite 不做框架編譯）
```

- **無後端、無資料庫**：IndexedDB / localStorage 全在使用者瀏覽器端
- **無任何前端框架**：不依賴 React/Vue；Tailwind 以 CDN 方式載入（刻意決策，見下方守則）
- 建置產物 = `dist/`（index.html + public/ 拷贝总計約 0.5 MB）

## 開發指令

```bash
npm install       # 安裝依賴（只有 vite / typescript / eslint 等開發工具）
npm run dev       # 本機開發伺服器
npm run check     # TypeScript 型別檢查（tsc -b）
npm run lint      # ESLint
npm run build     # 生產打包 → dist/（Vercel 部署的產物）
npm run preview   # 本機預覽建置結果
```

## 部署（Vercel）

- Framework：**Vite**｜Build：`npm run build`｜Output：`dist/`（已於 `vercel.json` 固化）
- `vercel.json` 另為 `/patterns/*` 與 favicon 加上 7 天快取標頭
- Node 需求：≥ 20.19（Vite 7 要求，Vercel 預設即符合）

---

# 🛡️ 防增肥守則（Vercel 配額保護，改版前必讀）

> 2026-09 大瘦身後的鐵律。每次改版被破壞一次，Vercel 儲存/頻寬配額就離爆滿近一步。

### 1. `.vercelignore` 是第一道防線
- 新增任何資料夾/檔案前，先問「**部署需要它嗎？**」不需要就加進 `.vercelignore`。
- 永不部署：`.git`、`node_modules`、`dist`、`*.bak`、`*.log`、`*.tmp`、`*.old`、`uploads/`（含 `public/uploads/`）、暫存檔、本機快取。
- ⚠️ `.vercelignore` 一旦建立就**取代預設忽略規則**，所以 `.git`、`node_modules` 必須明確保留在清單內，勿刪。

### 2. 圖片與靜態資源
- `public/patterns/` 內的編號 SVG（`1.svg`–`45.svg`）與 `blank.svg` 被 `index.html` 以絕對路徑引用，**缺一不可**；新增圖案要同步改 `index.html` 內 `Array.from({ length: 45 })` 的數量與相關 UI 數字（46 / 45 處）。
- **禁止**把設計原稿、參考截圖、測試照片放進 `public/` —— 它會被原封不動複製進每次部署。設計素材請放外部雲端相簿，不要進 Git。
- 新圖片進 `public/` 前必壓縮：SVG 用 SVGO，點陣圖考慮 WebP/AVIF，單檔儘量 < 100 KB。

### 3. 依賴極簡（`package.json`）
- **執行期依賴必須是 0 個**：本專案是純前端單檔應用，瀏覽器直接執行 `index.html`，`dependencies` 區塊應保持不存在或為空。
- 任何套件（包括未來想用的框架/圖示庫）都只能進 `devDependencies`，並先評估能否以 CDN 或原生 API 取代。
- 歷史教訓：本倉庫曾殘留 React + react-router + framer-motion + lucide-react + Tailwind 編譯鏈（為一個從未接線的脚手架），讓 `node_modules` 達 **193 MB**、全部被打進 Vercel 快取 —— 已全數移除，勿復辟。
- Tailwind 目前刻意用 CDN（`cdn.tailwindcss.com`）以維持 100% 既有 UI；若未來要改為建置期編譯，請一次改完並完整視覺回歸測試，**不要兩套並存**。

### 4. 死檔零容忍
- 刪功能時，連同它的圖片、CSS、孤立檔一起刪（用全域搜尋確認零引用）。
- 產出備份請用 Git Branch / Tag，**不要**在倉庫裡留 `*.bak`、`xxx_old.html`、`(1).png` 這類檔案。
- 上傳測試圖請放 `public/uploads/`（已被 git 與 Vercel 雙重忽略），測完即刪。

### 5. 每次交付前的守護流程（缺一不可）
```bash
npm run check && npm run lint && npm run build   # 全綠才可提交
git status                                        # 確認沒有誤加大型檔案
du -sh public dist                                # public 應 ≈ 0.5 MB，dist ~ 0.5 MB
```
- `dist/` 只應含 `index.html` + `public/` 複本；若突然變大，就是有東西混進來了。
