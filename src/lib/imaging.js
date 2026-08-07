/**
 * 低階影像處理工具（純函式，方便單獨測試）。
 * 所有遮罩皆為 Uint8Array，值 0 或 255。
 */

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function isNearWhite(r, g, b, a = 255) {
  return a > 10 && r > 232 && g > 232 && b > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 28;
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch { /* fall through */ }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 產生可重現的偽亂數（0..1）。 */
export function makeRandom(salt) {
  return (seed) => {
    const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
}

/* ------------------------------------------------------------------ *
 * 形態學：改用可分離（separable）掃描，複雜度由 O(n·r²) 降到 O(n·r)，
 * 大圖 + 大半徑時比原本快數倍。
 * ------------------------------------------------------------------ */

function morph(mask, w, h, radius, wantMax) {
  if (radius <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  // 水平
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let hit = wantMax ? 0 : 1;
      const from = Math.max(0, x - radius), to = Math.min(w - 1, x + radius);
      if (!wantMax && (x - radius < 0 || x + radius > w - 1)) { tmp[row + x] = 0; continue; }
      for (let i = from; i <= to; i++) {
        const v = mask[row + i] ? 1 : 0;
        if (wantMax) { if (v) { hit = 1; break; } }
        else if (!v) { hit = 0; break; }
      }
      tmp[row + x] = hit ? 255 : 0;
    }
  }
  // 垂直
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let hit = wantMax ? 0 : 1;
      const from = Math.max(0, y - radius), to = Math.min(h - 1, y + radius);
      if (!wantMax && (y - radius < 0 || y + radius > h - 1)) { out[y * w + x] = 0; continue; }
      for (let i = from; i <= to; i++) {
        const v = tmp[i * w + x] ? 1 : 0;
        if (wantMax) { if (v) { hit = 1; break; } }
        else if (!v) { hit = 0; break; }
      }
      out[y * w + x] = hit ? 255 : 0;
    }
  }
  return out;
}

export const dilate = (mask, w, h, radius = 1) => morph(mask, w, h, radius, true);
export const erode = (mask, w, h, radius = 1) => morph(mask, w, h, radius, false);
export const closeMask = (mask, w, h, r = 1) => erode(dilate(mask, w, h, r), w, h, r);
export const openMask = (mask, w, h, r = 1) => dilate(erode(mask, w, h, r), w, h, r);

export function boundaryMask(mask, w, h, thickness = 1) {
  const dil = dilate(mask, w, h, thickness);
  const ero = erode(mask, w, h, thickness);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (dil[i] && !ero[i]) out[i] = 255;
  return out;
}

/** 只保留最大的 N 個連通區塊（4-連通，非遞迴，使用 Int32Array 佇列）。 */
export function keepLargestComponents(mask, w, h, maxComponents = 2, minSize = 20) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const comps = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const members = [];
    while (head < tail) {
      const id = queue[head++];
      members.push(id);
      const x = id % w;
      if (x > 0 && !seen[id - 1] && mask[id - 1]) { seen[id - 1] = 1; queue[tail++] = id - 1; }
      if (x < w - 1 && !seen[id + 1] && mask[id + 1]) { seen[id + 1] = 1; queue[tail++] = id + 1; }
      if (id >= w && !seen[id - w] && mask[id - w]) { seen[id - w] = 1; queue[tail++] = id - w; }
      if (id < n - w && !seen[id + w] && mask[id + w]) { seen[id + w] = 1; queue[tail++] = id + w; }
    }
    if (members.length > minSize) comps.push(members);
  }
  comps.sort((a, b) => b.length - a.length);
  const out = new Uint8Array(n);
  for (const c of comps.slice(0, maxComponents)) for (const id of c) out[id] = 255;
  return out;
}

/** 從邊界往內 flood fill，找出背景像素。 */
export function floodBackground(w, h, data, bg, tolerance) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const bgIsWhite = isNearWhite(bg.r, bg.g, bg.b);

  const tryPush = (id) => {
    if (id < 0 || id >= n || visited[id]) return;
    const p = id * 4;
    const dist = colorDist(data[p], data[p + 1], data[p + 2], bg.r, bg.g, bg.b);
    const whiteBg = bgIsWhite && isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3]);
    if (dist > tolerance && !whiteBg) return;
    visited[id] = 255;
    queue[tail++] = id;
  };

  for (let x = 0; x < w; x++) { tryPush(x); tryPush((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { tryPush(y * w); tryPush(y * w + w - 1); }

  while (head < tail) {
    const id = queue[head++];
    const x = id % w;
    if (x > 0) tryPush(id - 1);
    if (x < w - 1) tryPush(id + 1);
    if (id >= w) tryPush(id - w);
    if (id < n - w) tryPush(id + w);
  }
  return visited;
}

/** 以邊緣取樣估計背景色（中位數，抗雜訊）。 */
export function estimateBackgroundColor(w, h, data) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  const rs = [], gs = [], bs = [];
  const sample = (x, y) => { const p = (y * w + x) * 4; rs.push(data[p]); gs.push(data[p + 1]); bs.push(data[p + 2]); };
  for (let x = 0; x < w; x += step) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += step) { sample(0, y); sample(w - 1, y); }
  const mid = (arr) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)] ?? 255; };
  return { r: mid(rs), g: mid(gs), b: mid(bs) };
}

/** 找出「與外部相連的近白像素」，用來移除透明 PNG 的貼紙白邊。 */
export function findConnectedWhiteBorder(w, h, data) {
  const n = w * h;
  const border = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  const isAlpha = (id) => data[id * 4 + 3] > 18;
  const isWhitePixel = (id) => {
    const p = id * 4;
    return isAlpha(id) && isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3]);
  };
  const push = (id) => { if (id >= 0 && id < n && !border[id] && isWhitePixel(id)) { border[id] = 1; queue[tail++] = id; } };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = y * w + x;
      if (!isWhitePixel(id)) continue;
      let outside = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!outside) outside = !isAlpha(id - 1) || !isAlpha(id + 1) || !isAlpha(id - w) || !isAlpha(id + w);
      if (outside) push(id);
    }
  }
  while (head < tail) {
    const id = queue[head++];
    const x = id % w;
    if (x > 0) push(id - 1);
    if (x < w - 1) push(id + 1);
    push(id - w);
    push(id + w);
  }
  return border;
}

/** 將遮罩轉為白色 canvas（用於 destination-in 裁切）。 */
export function maskToCanvas(mask, w, h, alpha = 255) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      const p = i * 4;
      d[p] = d[p + 1] = d[p + 2] = 255;
      d[p + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
