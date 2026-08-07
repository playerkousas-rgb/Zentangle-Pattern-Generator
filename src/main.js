import './style.css';
import { PATTERNS } from './lib/patterns.js';
import { ZentangleEngine, DEFAULT_SETTINGS, AbortedError } from './lib/generator.js';

const MAX_SIDE = 1200;
const STORAGE_KEY = 'zentangle:v2';
const REGION_COLORS = [
  [255, 107, 107], [78, 205, 196], [69, 183, 209], [150, 206, 180],
  [255, 234, 167], [253, 121, 168], [162, 155, 254], [0, 184, 148],
  [225, 112, 85], [9, 132, 227], [108, 92, 231], [254, 202, 87],
];

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(message, type = 'info') {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

class ZentangleApp {
  constructor() {
    this.engine = new ZentangleEngine(PATTERNS);
    this.selectedPatterns = new Set();
    this.originalImage = null;
    this.hasResult = false;
    this.filter = '';
    this.autoGenerate = true;
    this.abortController = null;

    this.mainCanvas = $('mainCanvas');
    this.regionCanvas = $('regionCanvas');
    this.compareCanvas = $('compareCanvas');
    this.originalCanvas = $('originalCanvas');
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.regionCtx = this.regionCanvas.getContext('2d', { willReadFrequently: true });
    this.compareCtx = this.compareCanvas.getContext('2d');
    this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });

    this.restoreSettings();
    this.bindEvents();
    this.renderPatternGrid();
    this.syncSettingsUI();
    $('totalCount').textContent = String(PATTERNS.length);
  }

  /* ---------------- 設定持久化 ---------------- */

  restoreSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.assign(this.engine.settings, { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) });
      if (Array.isArray(saved.selected)) this.selectedPatterns = new Set(saved.selected.filter((i) => i < PATTERNS.length));
      if (typeof saved.autoGenerate === 'boolean') this.autoGenerate = saved.autoGenerate;
    } catch { /* 忽略毀損的設定 */ }
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: this.engine.settings,
        selected: Array.from(this.selectedPatterns),
        autoGenerate: this.autoGenerate,
      }));
    } catch { /* 隱私模式可能無法寫入 */ }
  }

  syncSettingsUI() {
    const s = this.engine.settings;
    $('regionSlider').value = s.regionCount; $('regionValue').textContent = s.regionCount;
    $('densitySlider').value = s.density; $('densityValue').textContent = s.density;
    $('strokeSlider').value = Math.round(s.strokeWidth * 10); $('strokeValue').textContent = `${s.strokeWidth.toFixed(1)}px`;
    $('thresholdSlider').value = s.threshold; $('thresholdValue').textContent = s.threshold;
    $('addShading').checked = s.addShading;
    $('showOutline').checked = s.showOutline;
    $('featureStrength').value = s.featureStrength;
    $('bgOption').value = s.bgOption;
    $('autoGenerate').checked = this.autoGenerate;
    this.updateCount();
  }

  /* ---------------- 事件 ---------------- */

  bindEvents() {
    const uz = $('uploadZone');
    const fi = $('fileInput');
    uz.addEventListener('click', () => fi.click());
    uz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    uz.addEventListener('dragover', (e) => { e.preventDefault(); uz.classList.add('dragover'); });
    uz.addEventListener('dragleave', () => uz.classList.remove('dragover'));
    uz.addEventListener('drop', (e) => {
      e.preventDefault(); uz.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.load(file);
    });
    fi.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) this.load(f); e.target.value = ''; });

    // 直接貼上圖片
    window.addEventListener('paste', (e) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      if (item) { const f = item.getAsFile(); if (f) this.load(f); }
    });

    const onSetting = (id, apply, { reanalyse = false, clearTiles = false, immediate = false } = {}) => {
      $(id).addEventListener('input', (e) => {
        apply(e.target);
        if (clearTiles) this.engine.clearPatternCache();
        this.persist();
        if (!this.originalImage || !this.autoGenerate) return;
        if (immediate) this.generate({ reanalyse });
        else this.generateDebounced({ reanalyse });
      });
    };

    onSetting('densitySlider', (t) => { this.engine.settings.density = +t.value; $('densityValue').textContent = t.value; }, { clearTiles: true });
    onSetting('strokeSlider', (t) => { this.engine.settings.strokeWidth = +t.value / 10; $('strokeValue').textContent = `${(+t.value / 10).toFixed(1)}px`; }, { reanalyse: true, clearTiles: true });
    onSetting('thresholdSlider', (t) => { this.engine.settings.threshold = +t.value; $('thresholdValue').textContent = t.value; }, { reanalyse: true });
    onSetting('regionSlider', (t) => { this.engine.settings.regionCount = +t.value; $('regionValue').textContent = t.value; this.engine.regionPatternAssign = []; }, { reanalyse: true });
    onSetting('addShading', (t) => { this.engine.settings.addShading = t.checked; }, { immediate: true });
    onSetting('showOutline', (t) => { this.engine.settings.showOutline = t.checked; }, { immediate: true });
    onSetting('featureStrength', (t) => { this.engine.settings.featureStrength = t.value; }, { reanalyse: true, immediate: true });
    onSetting('bgOption', (t) => { this.engine.settings.bgOption = t.value; }, { immediate: true });

    $('autoGenerate').addEventListener('change', (e) => { this.autoGenerate = e.target.checked; this.persist(); });

    $('patternSearch').addEventListener('input', (e) => { this.filter = e.target.value.trim().toLowerCase(); this.renderPatternGrid(); });

    $('generateBtn').addEventListener('click', () => this.generate({ reanalyse: true }));
    $('downloadBtn').addEventListener('click', () => this.download());
    $('copyBtn').addEventListener('click', () => this.copyToClipboard());
    $('selectAllBtn').addEventListener('click', () => this.selectAll(true));
    $('clearAllBtn').addEventListener('click', () => this.clearAll());
    $('randomBtn').addEventListener('click', () => this.selectRandom(8));
    $('resetBtn').addEventListener('click', () => this.resetSettings());
    $('shuffleBtn').addEventListener('click', () => this.shuffle());
    $('applyAssignBtn').addEventListener('click', () => this.rerender());

    document.addEventListener('click', () => this.closePickers());

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.setView(e.currentTarget.dataset.view);
      });
    });

    // 在分區預覽上點擊 → 高亮並打開該區的圖案選擇器
    this.regionCanvas.addEventListener('click', (e) => this.handleRegionCanvasClick(e));

    // 比對原圖（按住）
    const cmp = $('compareBtn');
    const showCmp = () => this.setCompare(true);
    const hideCmp = () => this.setCompare(false);
    cmp.addEventListener('pointerdown', showCmp);
    cmp.addEventListener('pointerup', hideCmp);
    cmp.addEventListener('pointerleave', hideCmp);

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // 空白鍵在按鈕上等同點擊，交給瀏覽器處理，避免誤觸「比對原圖」。
      if (e.code === 'Space' && tag === 'BUTTON') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'g') { e.preventDefault(); this.generate({ reanalyse: true }); }
      else if (key === 'd') { e.preventDefault(); this.download(); }
      else if (key === 'c') { e.preventDefault(); this.copyToClipboard(); }
      else if (key === 'r') { e.preventDefault(); this.shuffle(); }
      else if (e.code === 'Space') { e.preventDefault(); this.setCompare(true); }
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') this.setCompare(false); });
  }

  /* ---------------- 圖案清單 ---------------- */

  renderPatternGrid() {
    const grid = $('patternGrid');
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    PATTERNS.forEach((pattern, i) => {
      if (this.filter && !pattern.name.toLowerCase().includes(this.filter)) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `pattern-item ${this.selectedPatterns.has(i) ? 'selected' : ''}`;
      item.title = pattern.name;
      item.dataset.index = String(i);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(this.selectedPatterns.has(i)));
      item.innerHTML = pattern.isBlank
        ? '<div class="w-full h-full bg-white"></div><div class="check-mark">✓</div>'
        : `<img src="${pattern.url}" class="w-full h-full object-contain p-1" alt="${pattern.name}" loading="lazy" decoding="async"><div class="check-mark">✓</div>`;
      item.addEventListener('click', () => this.togglePattern(i));
      frag.appendChild(item);
    });
    grid.appendChild(frag);
    if (!grid.children.length) {
      grid.innerHTML = '<p class="small-note col-span-4 py-6 text-center">找不到符合的圖案</p>';
    }
    this.updateCount();
  }

  refreshPatternSelection() {
    document.querySelectorAll('.pattern-item').forEach((el) => {
      const i = Number(el.dataset.index);
      const on = this.selectedPatterns.has(i);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    });
    this.updateCount();
  }

  updateCount() { $('selectedCount').textContent = String(this.selectedPatterns.size); }

  togglePattern(i) {
    if (this.selectedPatterns.has(i)) this.selectedPatterns.delete(i);
    else this.selectedPatterns.add(i);
    this.refreshPatternSelection();
    this.persist();
    if (this.originalImage && this.selectedPatterns.size && this.autoGenerate) {
      this.engine.assignPatterns(this.selectedPatterns);
      this.updateRegionUI();
      this.generateDebounced({});
    }
  }

  selectAll(excludeBlank = true) {
    this.selectedPatterns = new Set(PATTERNS.map((_, i) => i).filter((i) => !(excludeBlank && i === 0)));
    this.refreshPatternSelection();
    this.persist();
    if (this.originalImage && this.autoGenerate) { this.engine.assignPatterns(this.selectedPatterns); this.generateDebounced({}); }
  }

  selectRandom(n) {
    const pool = PATTERNS.map((_, i) => i).filter((i) => i !== 0);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.selectedPatterns = new Set(pool.slice(0, Math.min(n, pool.length)));
    this.refreshPatternSelection();
    this.persist();
    if (this.originalImage) { this.engine.setSalt(Math.random() * 10000); this.generate({ reanalyse: true, randomize: true }); }
  }

  clearAll() {
    this.selectedPatterns.clear();
    this.refreshPatternSelection();
    this.persist();
  }

  resetSettings() {
    Object.assign(this.engine.settings, DEFAULT_SETTINGS);
    this.engine.clearPatternCache();
    this.syncSettingsUI();
    this.persist();
    if (this.originalImage) this.generate({ reanalyse: true });
    toast('已重設為預設值');
  }

  /* ---------------- 載入圖片 ---------------- */

  async load(file) {
    if (!file.type.startsWith('image/')) { toast('請選擇圖片檔案', 'error'); return; }
    if (file.size > 25 * 1024 * 1024) { toast('圖片過大（上限 25MB）', 'error'); return; }

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('無法讀取圖片'));
        im.src = url;
      });

      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('圖片尺寸無效');
      if (w > MAX_SIDE || h > MAX_SIDE) {
        const scale = MAX_SIDE / Math.max(w, h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }

      this.originalImage = img;
      this.engine.setSalt(Math.random() * 10000);
      this.engine.regionPatternAssign = [];

      [this.mainCanvas, this.regionCanvas, this.compareCanvas, this.originalCanvas].forEach((c) => { c.width = w; c.height = h; });
      this.originalCtx.clearRect(0, 0, w, h);
      this.originalCtx.drawImage(img, 0, 0, w, h);
      this.engine.setSource(this.originalCtx.getImageData(0, 0, w, h));

      this.originalCanvas.hidden = false;
      $('originalPlaceholder').hidden = true;
      $('generateBtn').disabled = false;
      $('fileMeta').textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px${w !== img.naturalWidth ? ` （處理尺寸 ${w}×${h}）` : ''}`;

      if (this.selectedPatterns.size === 0) this.selectAll(true);
      await this.generate({ reanalyse: true });
    } catch (err) {
      console.error(err);
      toast(err.message || '圖片載入失敗', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------------- 生成 ---------------- */

  generateDebounced(opts) {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.generate(opts), 220);
  }

  async generate({ reanalyse = false, randomize = false } = {}) {
    if (!this.engine.sourceData) { toast('請先上傳圖片', 'error'); return; }
    if (!this.selectedPatterns.size) { toast('請至少選擇一個圖案', 'error'); return; }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;

    const overlay = $('processingOverlay');
    overlay.hidden = false;
    $('placeholderText').hidden = true;
    this.mainCanvas.hidden = false;
    const onProgress = (pct, text) => {
      $('progressBar').style.width = `${pct}%`;
      $('processingText').textContent = text;
    };

    const started = performance.now();
    try {
      const result = await this.engine.run({
        reanalyse, randomize,
        selected: this.selectedPatterns,
        onProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this.paintResult(result);
      if (reanalyse) { this.drawRegionPreview(); this.updateRegionUI(); }
      this.hasResult = true;
      $('downloadBtn').disabled = false;
      $('copyBtn').disabled = false;
      $('compareBtn').disabled = false;
      const ms = Math.round(performance.now() - started);
      if (ms > 1200) toast(`生成完成（${(ms / 1000).toFixed(1)}s）`);
    } catch (err) {
      if (err instanceof AbortedError) return;
      console.error(err);
      toast(err.message || '生成失敗', 'error');
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        overlay.hidden = true;
        $('progressBar').style.width = '0%';
      }
    }
  }

  async rerender() {
    if (!this.engine.analysed) return;
    const overlay = $('processingOverlay');
    overlay.hidden = false;
    try {
      const result = await this.engine.render({ onProgress: (p, t) => { $('progressBar').style.width = `${p}%`; $('processingText').textContent = t; } });
      this.paintResult(result);
    } finally {
      overlay.hidden = true;
      $('progressBar').style.width = '0%';
    }
  }

  shuffle() {
    if (!this.engine.sourceData) return;
    this.engine.setSalt(Math.random() * 10000);
    this.engine.regionPatternAssign = [];
    this.engine.clearPatternCache();
    this.generate({ reanalyse: true, randomize: true });
  }

  paintResult(canvas) {
    this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    this.mainCtx.drawImage(canvas, 0, 0);
  }

  /* ---------------- 分區 UI ---------------- */

  setView(view) {
    const regions = view === 'regions';
    $('regionAssignView').hidden = !regions;
    this.regionCanvas.hidden = !regions;
    this.mainCanvas.hidden = regions;
    if (regions) this.drawRegionPreview();
  }

  setCompare(on) {
    if (!this.hasResult) return;
    if (on) {
      this.compareCtx.clearRect(0, 0, this.compareCanvas.width, this.compareCanvas.height);
      this.compareCtx.drawImage(this.originalCanvas, 0, 0);
    }
    this.compareCanvas.hidden = !on;
  }

  drawRegionPreview() {
    const { width: w, height: h } = this.mainCanvas;
    if (!w || !h || !this.engine.regions.length) return;
    const img = this.regionCtx.createImageData(w, h);
    this.engine.regions.forEach((region, i) => {
      const [r, g, b] = REGION_COLORS[i % REGION_COLORS.length];
      const m = region.mask;
      for (let p = 0; p < w * h; p++) {
        if (!m[p]) continue;
        const q = p * 4;
        img.data[q] = r; img.data[q + 1] = g; img.data[q + 2] = b; img.data[q + 3] = 220;
      }
    });
    this.regionCtx.clearRect(0, 0, w, h);
    this.regionCtx.putImageData(img, 0, 0);
    this.regionCtx.globalCompositeOperation = 'multiply';
    this.regionCtx.drawImage(this.originalCanvas, 0, 0);
    this.regionCtx.globalCompositeOperation = 'source-over';
  }

  handleRegionCanvasClick(e) {
    const rect = this.regionCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.regionCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.regionCanvas.height / rect.height);
    const idx = this.engine.regionAt(x, y);
    if (idx < 0) return;
    const card = $('regionAssignGrid').children[idx];
    if (!card) return;
    document.querySelectorAll('.region-card').forEach((c) => c.classList.remove('highlight'));
    card.classList.add('highlight');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.querySelector('.region-preview')?.click();
  }

  closePickers() {
    document.querySelectorAll('.pattern-picker-popup').forEach((el) => el.classList.remove('active'));
  }

  updateRegionUI() {
    const grid = $('regionAssignGrid');
    grid.innerHTML = '';
    const fallback = Array.from(this.selectedPatterns)[0] ?? 0;
    const frag = document.createDocumentFragment();

    this.engine.regions.forEach((_, i) => {
      const currentIdx = this.engine.regionPatternAssign[i] ?? fallback;
      const p = PATTERNS[currentIdx] ?? PATTERNS[0];
      const color = REGION_COLORS[i % REGION_COLORS.length];

      const card = document.createElement('div');
      card.className = 'region-card';
      card.innerHTML = `<div class="flex items-center justify-center gap-1 mb-2">
        <span style="width:8px;height:8px;border-radius:50%;background:rgb(${color.join(',')})"></span>
        <span class="text-[10px] text-white/60">區域 ${i + 1}</span></div>`;

      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'region-preview w-12 h-12 border border-white/20 rounded cursor-pointer overflow-hidden bg-white hover:border-cyan-400 transition-all flex items-center justify-center mx-auto';
      preview.title = `區域 ${i + 1}：${p.name}`;
      preview.innerHTML = p.isBlank ? '<div class="w-full h-full bg-white"></div>' : `<img src="${p.url}" class="w-full h-full object-contain p-1" alt="${p.name}">`;

      const picker = document.createElement('div');
      picker.className = 'pattern-picker-popup';
      Array.from(this.selectedPatterns).forEach((idx) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'hover:bg-white/20 p-1 cursor-pointer rounded transition-colors bg-white';
        opt.title = PATTERNS[idx].name;
        opt.innerHTML = PATTERNS[idx].isBlank
          ? '<div class="w-8 h-8 bg-white mx-auto"></div>'
          : `<img src="${PATTERNS[idx].url}" class="w-8 h-8 object-contain mx-auto" alt="${PATTERNS[idx].name}" loading="lazy">`;
        opt.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.engine.regionPatternAssign[i] = idx;
          this.closePickers();
          this.updateRegionUI();
          this.rerender();
        });
        picker.appendChild(opt);
      });

      preview.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = picker.classList.contains('active');
        this.closePickers();
        if (!open) picker.classList.add('active');
      });

      card.append(preview, picker);
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  /* ---------------- 匯出 ---------------- */

  exportCanvas() {
    const scale = Number($('exportScale').value) || 1;
    const w = this.mainCanvas.width * scale;
    const h = this.mainCanvas.height * scale;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (this.engine.settings.bgOption === 'white') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(this.mainCanvas, 0, 0, w, h);
    return out;
  }

  download() {
    if (!this.hasResult) { toast('請先生成圖片', 'error'); return; }
    const canvas = this.exportCanvas();
    canvas.toBlob((blob) => {
      if (!blob) { toast('匯出失敗', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `zentangle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已下載 PNG');
    }, 'image/png');
  }

  async copyToClipboard() {
    if (!this.hasResult) { toast('請先生成圖片', 'error'); return; }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast('此瀏覽器不支援複製圖片', 'error');
      return;
    }
    try {
      const blob = await new Promise((res) => this.exportCanvas().toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('已複製到剪貼簿');
    } catch (err) {
      console.error(err);
      toast('複製失敗（可能需要 HTTPS 或權限）', 'error');
    }
  }
}

new ZentangleApp();
export { ZentangleApp, sleep };
