import {
  clamp, luma, colorDist, isNearWhite, makeCanvas, makeRandom,
  dilate, erode, closeMask, openMask, boundaryMask, keepLargestComponents,
  floodBackground, estimateBackgroundColor, findConnectedWhiteBorder, maskToCanvas,
} from './imaging.js';

export const DEFAULT_SETTINGS = {
  density: 52,
  strokeWidth: 1.2,
  threshold: 70,
  regionCount: 8,
  addShading: true,
  showOutline: true,
  featureStrength: 'medium',
  bgOption: 'white',
};

const FEATURE_CONFIGS = {
  low: { innerRadius: 5, darkMin: 34, darkMul: 0.55, gradMin: 54, gradMul: 1.25, colorMin: 58, colorMul: 0.78, alpha: 135, dilate: false },
  medium: { innerRadius: 3, darkMin: 38, darkMul: 0.68, gradMin: 38, gradMul: 0.95, colorMin: 34, colorMul: 0.55, alpha: 180, dilate: false },
  high: { innerRadius: 2, darkMin: 43, darkMul: 0.84, gradMin: 28, gradMul: 0.70, colorMin: 24, colorMul: 0.36, alpha: 220, dilate: true },
};

/** 使用者取消 / 有新的生成請求時丟出。 */
export class AbortedError extends Error {
  constructor() { super('aborted'); this.name = 'AbortedError'; }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * 核心禪繞畫生成器（與 DOM 無關，只吃 ImageData、吐 canvas）。
 */
export class ZentangleEngine {
  constructor(patterns) {
    this.patterns = patterns;
    this.settings = { ...DEFAULT_SETTINGS };
    this.sourceData = null;
    this.width = 0;
    this.height = 0;
    this.visibleMask = null;
    this.fillMask = null;
    this.lineMask = null;
    this.regions = [];
    this.regionPatternAssign = [];
    this.patternCache = new Map();
    this.imageCache = new Map();
    this.setSalt(Math.random() * 10000);
  }

  setSalt(salt) {
    this.salt = salt;
    this.rand = makeRandom(salt);
  }

  setSource(imageData) {
    this.sourceData = imageData;
    this.width = imageData.width;
    this.height = imageData.height;
    this.visibleMask = this.fillMask = this.lineMask = null;
    this.regions = [];
  }

  clearPatternCache() { this.patternCache.clear(); }

  featureConfig() { return FEATURE_CONFIGS[this.settings.featureStrength] ?? FEATURE_CONFIGS.medium; }

  get analysed() {
    return !!this.fillMask && this.fillMask.length === this.width * this.height;
  }

  /* -------------------- 遮罩擷取 -------------------- */

  extractMasks() {
    const { width: w, height: h } = this;
    const data = this.sourceData.data;
    const n = w * h;
    const visible = new Uint8Array(n);
    const fill = new Uint8Array(n);

    let transparentCount = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) transparentCount++;
    const hasTransparency = transparentCount > n * 0.01;

    if (hasTransparency) {
      // 透明 PNG 常有「貼紙白邊」：只移除與外部相連的近白像素，內部高光保留。
      const borderWhite = findConnectedWhiteBorder(w, h, data);
      let alphaCount = 0, visibleCount = 0;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        if (data[p + 3] > 18) {
          alphaCount++;
          if (!borderWhite[i]) {
            visible[i] = 255;
            visibleCount++;
            if (!isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3])) fill[i] = 255;
          }
        }
      }
      // 主體本身就是白色時，避免誤刪太多。
      if (visibleCount < alphaCount * 0.2) {
        visible.fill(0); fill.fill(0);
        for (let i = 0; i < n; i++) {
          const p = i * 4;
          if (data[p + 3] > 18) {
            visible[i] = 255;
            if (!isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3])) fill[i] = 255;
          }
        }
      }
    } else {
      const bg = estimateBackgroundColor(w, h, data);
      const bgVisited = floodBackground(w, h, data, bg, this.settings.threshold);
      for (let i = 0; i < n; i++) {
        if (!bgVisited[i]) {
          visible[i] = 255;
          const p = i * 4;
          if (!isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3])) fill[i] = 255;
        }
      }
    }

    this.visibleMask = closeMask(keepLargestComponents(visible, w, h, 2), w, h, 1);
    for (let i = 0; i < n; i++) if (!this.visibleMask[i]) fill[i] = 0;

    const cleaned = openMask(closeMask(fill, w, h, 2), w, h, 1);
    let count = 0;
    for (let i = 0; i < n; i++) if (cleaned[i]) count++;
    this.fillMask = count > 100 ? cleaned : this.visibleMask.slice();

    let visibleTotal = 0;
    for (let i = 0; i < n; i++) if (this.visibleMask[i]) visibleTotal++;
    return visibleTotal;
  }

  /* -------------------- 內部特徵線 -------------------- */

  extractLineMask() {
    const { width: w, height: h } = this;
    const d = this.sourceData.data;
    const n = w * h;
    const line = new Uint8Array(n);
    const dark = new Uint8Array(n);
    const sensitivity = this.settings.threshold;
    const cfg = this.featureConfig();

    // 向內縮：外型邊界不會被畫成黑色外輪廓。
    const innerMask = erode(this.visibleMask, w, h, cfg.innerRadius);

    // 預先算好亮度，避免內迴圈重複計算（明顯加速）。
    const lumBuf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      lumBuf[i] = luma(d[p], d[p + 1], d[p + 2]);
    }

    const darkCut = Math.max(cfg.darkMin, sensitivity * cfg.darkMul);
    for (let i = 0; i < n; i++) if (innerMask[i] && lumBuf[i] < darkCut) dark[i] = 255;
    const darkBoundary = boundaryMask(dark, w, h, 1);

    const gradCut = Math.max(cfg.gradMin, sensitivity * cfg.gradMul);
    const colorCut = Math.max(cfg.colorMin, sensitivity * cfg.colorMul);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const id = y * w + x;
        if (!innerMask[id]) continue;
        const centerLum = lumBuf[id];
        const L = (ni) => (innerMask[ni] ? lumBuf[ni] : centerLum);

        const tl = L(id - w - 1), tc = L(id - w), tr = L(id - w + 1);
        const ml = L(id - 1), mr = L(id + 1);
        const bl = L(id + w - 1), bc = L(id + w), br = L(id + w + 1);

        const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        const grad = Math.hypot(gx, gy);

        let edge = grad > gradCut;
        if (!edge) {
          const p = id * 4;
          const cr0 = d[p], cg0 = d[p + 1], cb0 = d[p + 2];
          const C = (ni) => (innerMask[ni] ? ni * 4 : p);
          let maxColor = 0;
          for (const ni of [id + 1, id + w, id - 1, id - w]) {
            const q = C(ni);
            const dist = colorDist(cr0, cg0, cb0, d[q], d[q + 1], d[q + 2]);
            if (dist > maxColor) maxColor = dist;
          }
          edge = maxColor > colorCut;
        }
        if (edge || darkBoundary[id]) line[id] = 255;
      }
    }

    let out = (cfg.dilate || this.settings.strokeWidth >= 2.1) ? dilate(line, w, h, 1) : line;
    for (let i = 0; i < n; i++) if (!innerMask[i]) out[i] = 0;
    this.lineMask = out;
    return out;
  }

  /* -------------------- 分區 -------------------- */

  segment() {
    const { width: w, height: h } = this;
    const mask = this.fillMask;
    const n = this.settings.regionCount;
    const pixels = [];
    let minX = w, minY = h, maxX = 0, maxY = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        pixels.push(y * w + x);
        sumX += x; sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    this.regions = [];
    if (!pixels.length) return this.regions;

    const cx = sumX / pixels.length, cy = sumY / pixels.length;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const data = this.sourceData.data;
    const seeds = [];

    for (let i = 0; i < n; i++) {
      // Golden-angle 種子：比純隨機更平均，salt 讓「重新分區」有效。
      const a = i * 2.399963 + this.rand(i + 1) * 0.65;
      const rr = Math.sqrt((i + 0.55) / n);
      const sx = cx + Math.cos(a) * bw * 0.42 * rr;
      const sy = cy + Math.sin(a) * bh * 0.42 * rr;
      let best = pixels[Math.floor(this.rand(i + 50) * pixels.length)];
      let bestD = Infinity;
      for (let k = 0; k < 80; k++) {
        const cand = pixels[Math.floor(this.rand(i * 101 + k) * pixels.length)];
        const x = cand % w, y = (cand / w) | 0;
        const dd = (x - sx) ** 2 + (y - sy) ** 2;
        if (dd < bestD) { bestD = dd; best = cand; }
      }
      const p = best * 4;
      seeds.push({ x: best % w, y: (best / w) | 0, r: data[p], g: data[p + 1], b: data[p + 2] });
    }

    // Lloyd relaxation：跑幾輪讓分區大小更平均、邊界更自然。
    const labels = new Int16Array(w * h).fill(-1);
    const sx = Math.max(50, bw), sy = Math.max(50, bh);
    const assign = () => {
      for (const id of pixels) {
        const x = id % w, y = (id / w) | 0, p = id * 4;
        let best = 0, bestScore = Infinity;
        for (let i = 0; i < seeds.length; i++) {
          const s = seeds[i];
          const spatial = Math.hypot((x - s.x) / sx, (y - s.y) / sy) * 100;
          const color = colorDist(data[p], data[p + 1], data[p + 2], s.r, s.g, s.b) * 0.12;
          const score = spatial + color;
          if (score < bestScore) { bestScore = score; best = i; }
        }
        labels[id] = best;
      }
    };
    for (let iter = 0; iter < 3; iter++) {
      assign();
      const acc = seeds.map(() => ({ x: 0, y: 0, r: 0, g: 0, b: 0, c: 0 }));
      for (const id of pixels) {
        const a = acc[labels[id]];
        const p = id * 4;
        a.x += id % w; a.y += (id / w) | 0;
        a.r += data[p]; a.g += data[p + 1]; a.b += data[p + 2];
        a.c++;
      }
      for (let i = 0; i < seeds.length; i++) {
        const a = acc[i];
        if (!a.c) continue;
        seeds[i] = { x: a.x / a.c, y: a.y / a.c, r: a.r / a.c, g: a.g / a.c, b: a.b / a.c };
      }
    }
    assign();

    const built = Array.from({ length: seeds.length }, () => ({ mask: new Uint8Array(w * h), count: 0 }));
    for (const id of pixels) {
      const r = built[labels[id]];
      r.mask[id] = 255;
      r.count++;
    }
    // 移除空分區並重新編號，讓 labels 與 regions 索引永遠一致。
    const remap = new Int16Array(seeds.length).fill(-1);
    this.regions = [];
    built.forEach((r, i) => {
      if (r.count > 0) { remap[i] = this.regions.length; this.regions.push(r); }
    });
    for (const id of pixels) labels[id] = remap[labels[id]];
    this.labels = labels;
    return this.regions;
  }

  /** 依畫布座標找出所屬分區索引，-1 表示不在主體內。 */
  regionAt(x, y) {
    if (!this.labels) return -1;
    const id = Math.round(y) * this.width + Math.round(x);
    if (id < 0 || id >= this.labels.length) return -1;
    return this.labels[id];
  }

  /* -------------------- 圖案分派 -------------------- */

  assignPatterns(selectedIndices, randomize = false) {
    const selected = Array.from(selectedIndices);
    if (!selected.length || !this.regions.length) return this.regionPatternAssign;
    const nonBlank = selected.filter((i) => i !== 0);
    const pool = nonBlank.length ? nonBlank : selected;

    if (randomize) {
      this.regionPatternAssign = this.regions.map((_, i) => pool[Math.floor(this.rand(i * 97 + pool.length * 13 + 5) * pool.length) % pool.length]);
      if (pool.length > 1) {
        for (let i = 1; i < this.regionPatternAssign.length; i++) {
          if (this.regionPatternAssign[i] === this.regionPatternAssign[i - 1]) {
            const cur = pool.indexOf(this.regionPatternAssign[i]);
            this.regionPatternAssign[i] = pool[(cur + 1 + Math.floor(this.rand(i * 41) * (pool.length - 1))) % pool.length];
          }
        }
      }
    } else {
      this.regionPatternAssign = this.regions.map((_, i) => selected[i % selected.length]);
    }
    return this.regionPatternAssign;
  }

  /* -------------------- 圖案 tile -------------------- */

  loadImage(url) {
    if (this.imageCache.has(url)) return this.imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`圖案載入失敗：${url}`));
      img.src = url;
    });
    this.imageCache.set(url, promise);
    return promise;
  }

  async getPatternTile(patternIndex) {
    const pattern = this.patterns[patternIndex];
    if (!pattern || pattern.isBlank) return null;
    const size = Math.round(this.settings.density);
    const key = `${patternIndex}-${size}-${this.settings.strokeWidth.toFixed(1)}`;
    if (this.patternCache.has(key)) return this.patternCache.get(key);

    const img = await this.loadImage(pattern.url);
    const base = makeCanvas(size, size);
    const bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.clearRect(0, 0, size, size);

    // SVG 筆畫常剛好碰到 tile 邊界，repeat 時會出現格線。
    // 裁掉外圍 9% 再放大，並讓 tile 邊緣 alpha 淡出，避免接縫。
    const iw = img.naturalWidth || img.width || 200;
    const ih = img.naturalHeight || img.height || 200;
    const crop = 0.09;
    bctx.drawImage(img, iw * crop, ih * crop, iw * (1 - crop * 2), ih * (1 - crop * 2), 0, 0, size, size);

    const image = bctx.getImageData(0, 0, size, size);
    const d = image.data;
    const fadeEdge = Math.max(2, Math.round(size * 0.055));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = (y * size + x) * 4;
        const avg = (d[p] + d[p + 1] + d[p + 2]) / 3;
        const ink = clamp((246 - avg) * 2.05, 0, 235);
        const distEdge = Math.min(x, y, size - 1 - x, size - 1 - y);
        const edgeFade = clamp(distEdge / fadeEdge, 0, 1);
        d[p] = d[p + 1] = d[p + 2] = 0;
        d[p + 3] = ink > 12 ? Math.round(ink * edgeFade) : 0;
      }
    }
    bctx.clearRect(0, 0, size, size);
    bctx.putImageData(image, 0, 0);

    const thick = makeCanvas(size, size);
    const tctx = thick.getContext('2d');
    const radius = Math.max(0, Math.round((this.settings.strokeWidth - 1) * 0.9));
    tctx.globalAlpha = 0.86;
    if (radius > 0) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) tctx.drawImage(base, dx, dy);
        }
      }
    }
    tctx.drawImage(base, 0, 0);

    if (this.patternCache.size > 120) this.patternCache.clear();
    this.patternCache.set(key, thick);
    return thick;
  }

  async fillRegionWithPattern(ctx, region, patternIndex, tint, regionIndex) {
    if (patternIndex === 0) return;
    const tile = await this.getPatternTile(patternIndex);
    if (!tile) return;
    const { width: w, height: h } = this;
    const layer = makeCanvas(w, h);
    const lctx = layer.getContext('2d');
    const pat = lctx.createPattern(tile, 'repeat');
    if (!pat) return;

    const offsetX = this.rand(patternIndex * 37 + regionIndex * 101 + 1) * tile.width;
    const offsetY = this.rand(patternIndex * 53 + regionIndex * 89 + 2) * tile.height;
    const angle = (this.rand(patternIndex * 71 + regionIndex * 43 + 3) - 0.5) * Math.PI * 0.55;
    const scale = 0.92 + this.rand(patternIndex * 29 + regionIndex * 67 + 4) * 0.18;

    lctx.save();
    lctx.translate(w / 2 + offsetX, h / 2 + offsetY);
    lctx.rotate(angle);
    lctx.scale(scale, scale);
    lctx.fillStyle = pat;
    lctx.fillRect(-w * 1.8, -h * 1.8, w * 3.6, h * 3.6);
    lctx.restore();

    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(maskToCanvas(region.mask, w, h), 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    if (tint > 0) {
      lctx.globalCompositeOperation = 'source-atop';
      lctx.fillStyle = `rgba(0,0,0,${tint})`;
      lctx.fillRect(0, 0, w, h);
      lctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(layer, 0, 0);
  }

  /* -------------------- 主流程 -------------------- */

  /**
   * @param {object} opts
   * @param {boolean} opts.reanalyse 重新分析遮罩/分區
   * @param {boolean} opts.randomize 隨機重排圖案
   * @param {Set<number>} opts.selected 已選圖案索引
   * @param {(pct:number,text:string)=>void} [opts.onProgress]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<HTMLCanvasElement>}
   */
  async run({ reanalyse, randomize, selected, onProgress = () => {}, signal }) {
    const check = () => { if (signal?.aborted) throw new AbortedError(); };
    check();

    if (reanalyse || !this.analysed) {
      onProgress(10, '擷取主體與背景…');
      await nextFrame(); check();
      this.extractMasks();

      onProgress(30, '提取內部特徵線…');
      await nextFrame(); check();
      this.extractLineMask();

      onProgress(50, '建立分區…');
      await nextFrame(); check();
      this.segment();
      this.assignPatterns(selected, randomize);
    }
    check();
    onProgress(65, '套用禪繞圖案…');
    await nextFrame();
    return this.render({ onProgress, signal });
  }

  async render({ onProgress = () => {}, signal } = {}) {
    const check = () => { if (signal?.aborted) throw new AbortedError(); };
    const { width: w, height: h } = this;
    const result = makeCanvas(w, h);
    const ctx = result.getContext('2d', { willReadFrequently: true });

    if (this.settings.bgOption === 'white') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    // 白色底形（透明 PNG 的外圍白邊已在遮罩階段移除）。
    const shapeLayer = makeCanvas(w, h);
    const shapeCtx = shapeLayer.getContext('2d');
    shapeCtx.fillStyle = '#fff';
    shapeCtx.fillRect(0, 0, w, h);
    shapeCtx.globalCompositeOperation = 'destination-in';
    shapeCtx.drawImage(maskToCanvas(this.visibleMask, w, h), 0, 0);
    ctx.drawImage(shapeLayer, 0, 0);

    for (let i = 0; i < this.regions.length; i++) {
      check();
      const pi = this.regionPatternAssign[i] ?? 0;
      const tint = this.settings.addShading ? (i % 4) * 0.025 : 0;
      await this.fillRegionWithPattern(ctx, this.regions[i], pi, tint, i);
      onProgress(65 + Math.round((i + 1) / this.regions.length * 25), '套用禪繞圖案…');
    }

    if (this.settings.addShading) {
      check();
      onProgress(92, '加入柔和陰影…');
      const shade = makeCanvas(w, h);
      const sctx = shade.getContext('2d');
      const img = sctx.createImageData(w, h);
      const d = this.sourceData.data;
      for (let i = 0; i < w * h; i++) {
        if (!this.fillMask[i]) continue;
        const p = i * 4;
        img.data[p + 3] = clamp((210 - luma(d[p], d[p + 1], d[p + 2])) * 0.18, 0, 28);
      }
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(shade, 0, 0);
    }

    if (this.settings.showOutline && this.lineMask) {
      check();
      onProgress(96, '描繪特徵線…');
      const lineCanvas = makeCanvas(w, h);
      const lctx = lineCanvas.getContext('2d');
      const img = lctx.createImageData(w, h);
      const alpha = this.featureConfig().alpha;
      for (let i = 0; i < w * h; i++) if (this.lineMask[i]) img.data[i * 4 + 3] = alpha;
      lctx.putImageData(img, 0, 0);
      ctx.drawImage(lineCanvas, 0, 0);
    }

    if (this.settings.bgOption === 'transparent') {
      const final = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < w * h; i++) if (!this.visibleMask[i]) final.data[i * 4 + 3] = 0;
      ctx.putImageData(final, 0, 0);
    }

    onProgress(100, '完成');
    return result;
  }
}
