# SCOPE — 這個 repo 做什麼、不做什麼

> 一句話：**一個純前端、零後端、零執行期依賴的禪繞畫圖案產生器**。
> 用「做／唔做」清單防止功能蔓延（scope creep），任何新增功能先對照本頁。

## ✅ 做（In scope）

| 功能 | 為何屬於這裡 |
|---|---|
| 上傳／拍照／貼上／拖放圖片 | 核心入口；手機優先 |
| 主體提取、去背、白邊處理 | 決定分區質素 |
| 邊緣感知分區（2–16）、Zendala 放射分區 | 產品差異化 |
| 45 款原創禪繞圖案、密度／線條／深淺可調 | 核心價值 |
| 圖鑑、步驟教學、最愛 | 學習曲線 |
| 列印（A4／圖案表／方磚／Zendala／Bijou） | 實體使用場景 |
| 作品集（IndexedDB）、PNG／SVG 線稿匯出 | 本地、無伺服器 |
| SEO／OG／PWA 圖標、無障礙、雙版號、版權 | 交付質量底線 |

## ❌ 唔做（Out of scope，附理由）

| 候選功能 | 唔做原因 | 如果真要做 |
|---|---|---|
| 帳號／雲端作品集／分享連結 | 需要後端、資料庫、隱私政策；違背「零上傳」定位 | 另開 repo（Type C：Apps Script／Supabase） |
| AI 生成圖案／AI 重繪 | 要 API key、要 server-side secret、香港 IP 直連被封 | 另開 Type C；本 app 保持零 key |
| 完整向量重繪（把筆觸變 vector path） | 現時管線係點陣（pattern tile → canvas）；改寫等於重做 renderer | 先做「向量線稿」（已做），再評估 |
| 47＋ 款圖案、圖案商店 | 每加一款要同步 5 處＋回歸測試；體積與維護成本 | 分批加，每次跑 e2e |
| 多語介面（英／日） | **EXCEPTION: L1** — 2026-10 已上線，`docs/44` 唔追溯既有 App — 保留 README 英文簡介 — 持續 | 如需全站雙語，另行立項；現時冇語言切換掣 |
| 使用者上傳自訂 SVG 圖案 | 安全（XSS／外部資源）＋ 版權不明 | 只接受純 path、消毒後本地使用 |
| 後台統計／A-B test | 需要後端與 cookie 同意 | 只用 Vercel Analytics 匿名 snippet |

## 發佈與入口（SG18／SG19）

- 真理倉 `docs/51` §2 **B 組**：有本機作品，但每幅可匯出原 PNG；無 `/api`、無 Service Worker。Vite 由根 `index.html` 建置；`public/store_gate_v1.0.js` 原樣進 `dist/` 發佈根目錄。
- `appKey: 'zentangle-pattern-generator'`、`mode: 'entry-gate'`、`portalIds: ['appstore']`、`silentPortalIds: ['library']`、`allowStandalone: true`、`autoRedirectSeconds: 0`；`supportNudge` 關，唔設 `trackEndpoint`。
- 正式 host `zentangle-pattern-generator.vercel.app` 對 [`20261116-app-slug-seed.sql` 第 84 行](https://github.com/playerkousas-rgb/website/blob/4d2e4dd2b5bc2c42987f261117755243edf88b01/migrations/20261116-app-slug-seed.sql#L84) → SG18 slug `zentangle-pattern-generator`。只交俾 `ScoutStoreGate.getAppStoreUrl()` 組連結；主站自己處理讚好同收藏。
- 唔改 `zt-favs` 或 `zt-gallery/works`。閘門只喺合資格入口入場時寫 `sessionStorage['zentangle-pattern-generator.store_pass']` 保同分頁重整；無新增持久儲存 key。

## 非功能底線

- `dist` ≤ 1 MB、單檔 `index.html` ≤ 5 MB
- 執行期依賴 0、圖標 9 件 ≤ 260 KB
- 所有運算在瀏覽器，圖片不上傳
- 鍵盤可完成主要流程；`prefers-reduced-motion` 未做（見建議）
- 瀏覽器支援：最近兩個版本 Chrome／Edge／Safari／Firefox（iOS 15+）

## 變更流程

1. 新功能先問：屬上表「做」還是「唔做」？
2. 屬「唔做」→ 開 issue 記低理由，唔好順手加。
3. 屬「做」→ 跟 `AGENTS.md` 開工清單，`npm run verify` ＋ `npm run test:e2e` 全綠才合併。
