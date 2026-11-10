# AGENTS.md — AI／工程師施工邊界（v1.2.0）

> 交俾 AI 改之前先讀呢 40 行。目標：唔好為咗「交功課」而破壞體積、版權、版號同單檔架構。

## 1. 開工前 60 秒

```bash
npm ci                # 若環境有 NODE_ENV=production，請用 npm ci --include=dev（見 §7）
npm run verify        # check → lint → test → build → app_check → css:check
```

紅燈就停手，唔好「順手」改規則去令它變綠。

## 2. 硬邊界（改動前必須確認）

| 邊界 | 規則 | 檢查 |
|---|---|---|
| 執行期依賴 | `dependencies` 必須 **0 個** | `app_check` S3 |
| 單檔架構 | UI／邏輯全部留在 `index.html`；唔准引入 React／Vue／jQuery | 人手 |
| Tailwind | 建置期編譯（`src/tailwind.css` → `public/tailwind.css`）；**唔准**加回 CDN | `app_check` S7/css |
| 圖案檔名 | `public/patterns/1.svg`～`45.svg` ＋ `blank.svg`，程式用絕對路徑；改名＝斷圖 | 人手＋e2e |
| 圖標 | `public/icons/` 九個 PNG／ICO；**唔准** SVG／WebP／AVIF | `app_check` G11 |
| 版號 | 四處一齊改：`APP_VERSION`、`<meta app-version>`、頁尾、`package.json` | `app_check` V1/V2 |
| 版權 | 頁尾、`<meta copyright>`、列印頁腳、PNG `tEXt` ＋ DCT 水印 | `app_check` W1／`npm test` |
| 部署體積 | `dist` ≤ 1 MB、圖標 ≤ 260 KB | `app_check` S7／CI |
| 秘密 | 任何 key／token 唔准入 repo、唔准入前端 | `repo_health` |

## 3. 唔准做

- ❌ 把設計原稿、測試相片、截圖放入 `public/`（會被部署）
- ❌ 加 `*.bak`／`*_old.html`／`(1).png`（用 Git branch／tag 備份）
- ❌ 兩套 CSS 並存（CDN ＋ 建置期）
- ❌ 改 `.vercelignore` 令 `.git`／`node_modules` 可以上傳
- ❌ 改 `scripts/audit_single_html_v1.0.mjs`／`seo_check_v1.0.mjs` 去遷就本 repo（呢兩支係規範倉庫嘅真理，要改就改上游）
- ❌ 用 `alert()`／直接 refresh 做錯誤處理（有 `toast()`）

## 4. 加新圖案（45 → 46）嘅完整清單

1. `public/patterns/46.svg`（同現有格式一致：`viewBox="0 0 200 200"`、`width/height="200"`、白底 rect ＋ 單一 `<path>`）
2. `index.html`：`Array.from({ length: 45 })` → `46`
3. UI 數字：`/46`、`共 45 款`、`45 款`（全檔搜 `45` 同 `46`）
4. `docs/REVIEW`／README 嘅「45 款」描述
5. `npm run verify && npm run test:e2e`（e2e 會驗圖案格數）

## 5. 改版流程（V 系列）

```bash
# 1. 四處改版號（見上表）
# 2. CHANGELOG.md 加一節
npm run verify
npm run test:e2e        # 需要本機 Chrome；CI 亦會跑
git commit -m "feat(scope): 做咩"
```

## 6. 檔案地圖

```
index.html                應用本體（UI + 邏輯 + 水印 codec + SVG 線稿）
build-css.mjs             npm run css 入口（缺 Tailwind CLI 時保底；部署必需）
.npmrc                    include=dev（唔可以被略過，見 §7）
public/patterns/          45 款圖案 SVG（部署必需）
public/icons/             9 個圖標（部署必需）
public/tailwind.css       建置產物（committed；由 npm run css 產生）
src/tailwind.css          Tailwind 入口（唔部署）
design/                   圖標母圖（唔部署）
scripts/                  app_check ＋ 規範檢查器 ＋ 圖標建置（唔部署）
tests/                    單元測試（node:test）＋ e2e（puppeteer-core）
docs/                     審查報告（唔部署）
```

## 7. 出事第一句

- 部署壞 → Vercel 回滾上一個 deployment
- `tailwindcss: command not found`／`[BUILD_UTILS_SPAWN_127]` → 建置環境
  `NODE_ENV=production` 令 `npm ci` 略過 devDependencies。修法：
  `.npmrc` 保留 `include=dev`、`vercel.json` 用 `npm ci --include=dev`；
  `build-css.mjs` 會喺缺 CLI 時沿用已 commit 的 CSS（`app_check` `S7/devdeps` 會擋復發）
- 體積爆 → `du -sh dist public/icons public/patterns`，對 `app_check` 邊項紅
- 圖案唔見 → 九成係 `public/patterns` 檔名或 `.vercelignore` 改錯
