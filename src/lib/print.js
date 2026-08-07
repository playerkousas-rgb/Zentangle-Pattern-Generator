/**
 * 列印輸出：把生成結果排成 A4 版面，供旅團現場列印使用。
 *
 * 三種用途模式：
 *  - lineart  純黑線稿，留白給團員上色
 *  - trace    淡灰底稿，照著描；可再留白部分分區當練習題
 *  - finished 完整成品，直接當作品印出
 */

export const PRINT_MODES = {
  lineart: { label: '填色線稿（純黑線 / 留白上色）', shading: false },
  trace: { label: '描繪底稿（淡灰 / 照著畫）', shading: false },
  finished: { label: '完整成品', shading: null },
};

export const FOOTER_TEXT = 'COPY RIGHT Scout System';

/** A4 可用版面（mm），四邊各留 10mm 邊界，底部再留 8mm 給頁尾。 */
export const PAGE = { width: 210, height: 297, margin: 10, footer: 8 };

/**
 * 依模式後製畫布：回傳新的 canvas，不動到原圖。
 * @param {HTMLCanvasElement} source
 * @param {'lineart'|'trace'|'finished'} mode
 * @param {number} threshold 線稿二值化門檻（0-255）
 */
export function applyPrintStyle(source, mode, threshold = 190) {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });

  // 一律先鋪白底：列印不該有透明區，否則部分驅動會印成黑塊。
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);

  if (mode === 'finished') return out;

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  if (mode === 'lineart') {
    // 二值化：省墨、線條銳利，影印也不會糊成灰塊。
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum < threshold ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  } else if (mode === 'trace') {
    // 淡灰：保留灰階層次，但整體提亮到大約 22% 濃度，方便在上面描線。
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const ink = (255 - lum) * 0.22;
      const v = Math.round(255 - ink);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * 建立列印用的頁面 DOM。
 * @param {object} opts
 * @param {string} opts.dataUrl 已後製好的圖片
 * @param {number} opts.copies 總份數
 * @param {1|2|4} opts.perPage 每頁張數
 * @param {boolean} opts.cutMarks 是否畫裁切格線
 * @returns {HTMLElement} 可直接掛到 document 上的容器
 */
export function buildPrintPages({ dataUrl, copies, perPage, cutMarks = true }) {
  const root = document.createElement('div');
  root.className = 'print-root';
  const pageCount = Math.ceil(copies / perPage);
  let remaining = copies;

  for (let p = 0; p < pageCount; p++) {
    const page = document.createElement('section');
    page.className = `print-page per-${perPage}`;

    const grid = document.createElement('div');
    grid.className = 'print-grid';
    const onThisPage = Math.min(perPage, remaining);

    for (let i = 0; i < onThisPage; i++) {
      const slot = document.createElement('div');
      slot.className = `print-slot${cutMarks && perPage > 1 ? ' cut-marks' : ''}`;
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '禪繞畫';
      slot.appendChild(img);
      grid.appendChild(slot);
    }
    remaining -= onThisPage;

    const footer = document.createElement('div');
    footer.className = 'print-footer';
    footer.textContent = FOOTER_TEXT;

    page.append(grid, footer);
    root.appendChild(page);
  }
  return root;
}

/**
 * 執行列印：把頁面掛進 document、呼叫 print()，結束後清掉。
 * 等圖片 decode 完才印，避免 Safari／Firefox 印出空白頁。
 */
export async function printPages(pagesRoot) {
  const old = document.querySelector('.print-root');
  if (old) old.remove();
  document.body.appendChild(pagesRoot);

  const images = Array.from(pagesRoot.querySelectorAll('img'));
  await Promise.all(images.map((img) => (img.complete ? img.decode().catch(() => {}) : new Promise((res) => {
    img.onload = img.onerror = () => res();
  }))));
  // 給瀏覽器一次 layout 的機會
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  window.print();

  const cleanup = () => {
    pagesRoot.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // 部分瀏覽器不會觸發 afterprint，保險起見延遲清除
  setTimeout(() => { if (document.body.contains(pagesRoot)) cleanup(); }, 60000);
}
