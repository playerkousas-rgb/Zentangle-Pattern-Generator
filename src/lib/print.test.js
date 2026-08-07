/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildPrintPages, FOOTER_TEXT, applyPrintStyle } from './print.js';

/** 讓 applyPrintStyle 可在 jsdom 下跑：用真實像素緩衝的 2D context 替身。 */
function stubCanvas() {
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(a, b) { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    };
  }
  HTMLCanvasElement.prototype.getContext = function () {
    if (!this._buf) this._buf = new Uint8ClampedArray(this.width * this.height * 4);
    const self = this;
    return {
      fillStyle: '#fff',
      fillRect() {
        for (let i = 0; i < self._buf.length; i += 4) {
          self._buf[i] = self._buf[i + 1] = self._buf[i + 2] = 255;
          self._buf[i + 3] = 255;
        }
      },
      drawImage(src) { if (src?._buf) self._buf.set(src._buf); },
      getImageData() {
        const img = new ImageData(self.width, self.height);
        img.data.set(self._buf);
        return img;
      },
      putImageData(img) { self._buf.set(img.data); },
    };
  };
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
}

beforeAll(stubCanvas);

/** 建立一張帶中灰的來源畫布。 */
function sourceCanvas(gray) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  c._buf = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < c._buf.length; i += 4) {
    c._buf[i] = c._buf[i + 1] = c._buf[i + 2] = gray;
    c._buf[i + 3] = 255;
  }
  return c;
}

describe('applyPrintStyle', () => {
  it('lineart binarises dark pixels to pure black', () => {
    const out = applyPrintStyle(sourceCanvas(60), 'lineart', 190);
    expect(out._buf[0]).toBe(0);
    expect(out._buf[3]).toBe(255);
  });

  it('lineart binarises light pixels to pure white', () => {
    const out = applyPrintStyle(sourceCanvas(220), 'lineart', 190);
    expect(out._buf[0]).toBe(255);
  });

  it('threshold controls what counts as ink', () => {
    expect(applyPrintStyle(sourceCanvas(200), 'lineart', 190)._buf[0]).toBe(255);
    expect(applyPrintStyle(sourceCanvas(200), 'lineart', 235)._buf[0]).toBe(0);
  });

  it('trace mode lightens ink but keeps it visible', () => {
    const out = applyPrintStyle(sourceCanvas(0), 'trace');
    // 全黑 → 約 22% 濃度 ≈ 199
    expect(out._buf[0]).toBeGreaterThan(180);
    expect(out._buf[0]).toBeLessThan(215);
  });

  it('finished mode leaves pixels untouched', () => {
    const out = applyPrintStyle(sourceCanvas(123), 'finished');
    expect(out._buf[0]).toBe(123);
  });

  it('always outputs an opaque canvas (no transparent print areas)', () => {
    const out = applyPrintStyle(sourceCanvas(128), 'lineart');
    for (let i = 3; i < out._buf.length; i += 4) expect(out._buf[i]).toBe(255);
  });
});

describe('buildPrintPages', () => {
  const count = (root, sel) => root.querySelectorAll(sel).length;

  it('puts one image per page when perPage is 1', () => {
    const root = buildPrintPages({ dataUrl: 'x', copies: 3, perPage: 1 });
    expect(count(root, '.print-page')).toBe(3);
    expect(count(root, '.print-slot')).toBe(3);
  });

  it('packs 4 copies per page and rounds pages up', () => {
    const root = buildPrintPages({ dataUrl: 'x', copies: 10, perPage: 4 });
    expect(count(root, '.print-page')).toBe(3);
    expect(count(root, '.print-slot')).toBe(10);
    // 最後一頁只放剩下的 2 張，不補空格
    const last = root.querySelectorAll('.print-page')[2];
    expect(last.querySelectorAll('.print-slot').length).toBe(2);
  });

  it('adds the copyright footer to every page', () => {
    const root = buildPrintPages({ dataUrl: 'x', copies: 5, perPage: 2 });
    const footers = root.querySelectorAll('.print-footer');
    expect(footers.length).toBe(3);
    footers.forEach((f) => expect(f.textContent).toBe(FOOTER_TEXT));
  });

  it('applies the per-N layout class used by the print stylesheet', () => {
    const root = buildPrintPages({ dataUrl: 'x', copies: 2, perPage: 2 });
    expect(root.querySelector('.print-page').classList.contains('per-2')).toBe(true);
  });

  it('only draws cut marks for multi-up layouts', () => {
    const one = buildPrintPages({ dataUrl: 'x', copies: 1, perPage: 1, cutMarks: true });
    expect(count(one, '.cut-marks')).toBe(0);
    const four = buildPrintPages({ dataUrl: 'x', copies: 4, perPage: 4, cutMarks: true });
    expect(count(four, '.cut-marks')).toBe(4);
    const off = buildPrintPages({ dataUrl: 'x', copies: 4, perPage: 4, cutMarks: false });
    expect(count(off, '.cut-marks')).toBe(0);
  });

  it('handles a single copy', () => {
    const root = buildPrintPages({ dataUrl: 'x', copies: 1, perPage: 4 });
    expect(count(root, '.print-page')).toBe(1);
    expect(count(root, '.print-slot')).toBe(1);
  });
});
