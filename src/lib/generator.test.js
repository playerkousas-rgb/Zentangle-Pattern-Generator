/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll } from 'vitest';
import { ZentangleEngine, DEFAULT_SETTINGS } from './generator.js';

/** jsdom 沒有 canvas 2D context，這裡用最小可用的替身。 */
function stubCanvas() {
  globalThis.OffscreenCanvas = undefined;
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(a, b, c) {
        if (a instanceof Uint8ClampedArray) {
          this.data = a; this.width = b; this.height = c ?? a.length / 4 / b;
        } else {
          this.width = a; this.height = b;
          this.data = new Uint8ClampedArray(a * b * 4);
        }
      }
    };
  }
  HTMLCanvasElement.prototype.getContext = function () {
    const w = () => this.width, h = () => this.height;
    return {
      canvas: this,
      globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000',
      clearRect() {}, fillRect() {}, drawImage() {}, save() {}, restore() {},
      translate() {}, rotate() {}, scale() {}, putImageData() {},
      createPattern: () => ({}),
      createImageData: (a, b) => new ImageData(a ?? w(), b ?? h()),
      getImageData: (x, y, a, b) => new ImageData(a ?? w(), b ?? h()),
    };
  };
}

/** 白底、中央一塊深色方塊。 */
function makeSubjectImage(w = 60, h = 60) {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const inside = x > 12 && x < w - 12 && y > 12 && y < h - 12;
      const v = inside ? 40 : 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  return img;
}

const PATTERNS = [{ name: '空白', url: '', isBlank: true }, { name: '圖案 1', url: '/x.svg' }];

beforeAll(stubCanvas);

describe('ZentangleEngine', () => {
  it('starts with default settings', () => {
    const e = new ZentangleEngine(PATTERNS);
    expect(e.settings).toEqual(DEFAULT_SETTINGS);
    expect(e.analysed).toBe(false);
  });

  it('extracts a subject mask from a white background image', () => {
    const e = new ZentangleEngine(PATTERNS);
    e.setSource(makeSubjectImage());
    const visible = e.extractMasks();
    expect(visible).toBeGreaterThan(500);
    expect(e.analysed).toBe(true);
    // 角落是背景，中心是主體
    expect(e.visibleMask[0]).toBe(0);
    expect(e.visibleMask[30 * 60 + 30]).toBe(255);
  });

  it('segments the subject into the requested number of regions', () => {
    const e = new ZentangleEngine(PATTERNS);
    e.setSource(makeSubjectImage());
    e.settings.regionCount = 4;
    e.extractMasks();
    const regions = e.segment();
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.length).toBeLessThanOrEqual(4);
    // labels 與 regions 索引一致
    const label = e.regionAt(30, 30);
    expect(label).toBeGreaterThanOrEqual(0);
    expect(label).toBeLessThan(regions.length);
    expect(e.regions[label].mask[30 * 60 + 30]).toBe(255);
  });

  it('assigns a pattern to every region and avoids blank when possible', () => {
    const e = new ZentangleEngine(PATTERNS);
    e.setSource(makeSubjectImage());
    e.extractMasks();
    e.segment();
    const assign = e.assignPatterns(new Set([0, 1]), true);
    expect(assign).toHaveLength(e.regions.length);
    expect(assign.every((i) => i === 1)).toBe(true);
  });

  it('produces reproducible segmentation for the same salt', () => {
    const build = () => {
      const e = new ZentangleEngine(PATTERNS);
      e.setSalt(1234);
      e.setSource(makeSubjectImage());
      e.settings.regionCount = 5;
      e.extractMasks();
      e.segment();
      return Array.from(e.labels);
    };
    expect(build()).toEqual(build());
  });

  it('extracts inner feature lines without drawing the outer silhouette', () => {
    const e = new ZentangleEngine(PATTERNS);
    e.setSource(makeSubjectImage());
    e.extractMasks();
    const lines = e.extractLineMask();
    expect(lines).toHaveLength(60 * 60);
    // 主體最外圈不應該有線
    expect(lines[13 * 60 + 13]).toBe(0);
  });
});
