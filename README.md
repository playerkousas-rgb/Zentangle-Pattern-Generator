# 禪繞畫工具 · Zentangle Pattern Generator

上傳一張圖片，工具會自動擷取主體、切成數個區塊，並在每個區塊填入不同的禪繞（Zentangle）圖案，最後可匯出高解析度 PNG。

## 功能

- **自動去背**：透明 PNG 走 alpha 通道並移除「貼紙白邊」；一般圖片用邊界 flood fill 推估背景色。
- **智慧分區**：Golden-angle 種子 + 3 輪 Lloyd relaxation 的色彩／空間混合 k-means，分區大小更平均、邊界更自然。
- **內部特徵線**：Sobel 梯度 + 色差 + 暗部邊界，保留眼睛、表情等細節，但不會描出黑色外輪廓。
- **無縫拼貼**：圖案 tile 會裁邊、邊緣淡出，並依區塊隨機偏移／旋轉／縮放，避免出現格線與整齊排列感。
- **互動編輯**：切換到「分區」分頁後，可直接在預覽圖上點擊區塊，指定該區要用哪個圖案。
- **匯出**：1x / 2x / 3x PNG 下載，或一鍵複製到剪貼簿。
- **其他**：貼上 (Ctrl+V) 上傳、圖案搜尋、設定自動存到 localStorage、進度條、可取消的重複生成、鍵盤快捷鍵。

## 快捷鍵

| 鍵 | 動作 |
| --- | --- |
| `G` | 生成 |
| `D` | 下載 PNG |
| `C` | 複製到剪貼簿 |
| `R` | 重新分區 / 隨機置換圖案 |
| `空白鍵` | 按住比對原圖 |

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 產出 dist/
npm run preview  # 預覽 build 結果
npm test         # 執行單元測試 (vitest)
npm run lint     # ESLint
```

## 專案結構

```
index.html                 # 頁面骨架（純 HTML，無框架）
src/
  main.js                  # UI 控制層：事件、狀態、DOM 更新
  style.css                # Tailwind v4 + 自訂樣式
  lib/
    imaging.js             # 低階影像運算（形態學、flood fill、連通元件…）
    generator.js           # ZentangleEngine：遮罩 → 分區 → 上圖案 → 輸出
    patterns.js            # 用 import.meta.glob 自動掃描圖案清單
    *.test.js              # 單元測試
  assets/patterns/*.svg    # 圖案素材
```

## 新增圖案

把 SVG 丟進 `src/assets/patterns/` 就好，清單會自動更新（不需要改任何程式碼）。

- 數字檔名（`1.svg`、`2.svg`…）顯示為「圖案 N」並依數字排序
- `blank.svg` 是保留檔名，代表「空白」選項
- 其他檔名以檔名顯示，排在數字之後

建議素材為黑線白底、正方形、去除外框，拼貼效果最佳。

## 使用建議

- 透明 PNG 或乾淨白底插畫效果最好。
- 背景較複雜時，調高「背景容差」再重新生成。
- 不勾選「空白」圖案，成品會更接近滿版禪繞畫。
- 圖片會先縮到最長邊 1200px 再運算；匯出時再依倍率放大。

---

COPY RIGHT 2026 SKWSCOUT
