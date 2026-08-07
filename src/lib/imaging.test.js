import { describe, it, expect } from 'vitest';
import {
  clamp, luma, colorDist, isNearWhite, dilate, erode, closeMask,
  boundaryMask, keepLargestComponents, estimateBackgroundColor, floodBackground,
} from './imaging.js';

const grid = (rows) => {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((row, y) => row.forEach((v, x) => { m[y * w + x] = v ? 255 : 0; }));
  return { mask: m, w, h };
};
const toRows = (mask, w, h) =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (mask[y * w + x] ? 1 : 0)));

describe('scalar helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
  it('computes luma', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255);
    expect(luma(0, 0, 0)).toBe(0);
  });
  it('computes color distance', () => {
    expect(colorDist(0, 0, 0, 0, 0, 0)).toBe(0);
    expect(colorDist(255, 0, 0, 0, 0, 0)).toBe(255);
  });
  it('detects near-white', () => {
    expect(isNearWhite(250, 250, 250)).toBe(true);
    expect(isNearWhite(100, 100, 100)).toBe(false);
    expect(isNearWhite(250, 250, 250, 0)).toBe(false);
  });
});

describe('morphology', () => {
  const single = grid([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);

  it('dilate grows a single pixel into a 3x3 block', () => {
    const out = dilate(single.mask, single.w, single.h, 1);
    expect(toRows(out, single.w, single.h)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
  });

  it('erode removes a single pixel', () => {
    const out = erode(single.mask, single.w, single.h, 1);
    expect(out.some(Boolean)).toBe(false);
  });

  it('dilate then erode restores a solid block (closing is idempotent-ish)', () => {
    const block = grid([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const out = closeMask(block.mask, block.w, block.h, 1);
    expect(toRows(out, block.w, block.h)).toEqual(toRows(block.mask, block.w, block.h));
  });

  it('radius 0 is a no-op', () => {
    const out = dilate(single.mask, single.w, single.h, 0);
    expect(Array.from(out)).toEqual(Array.from(single.mask));
  });
});

describe('boundaryMask', () => {
  it('returns only the outline of a filled square', () => {
    const g = grid([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const out = boundaryMask(g.mask, g.w, g.h, 1);
    // 中心像素被侵蝕保留，因此不在邊界上
    expect(out[2 * 5 + 2]).toBe(0);
    expect(out[1 * 5 + 1]).toBe(255);
  });
});

describe('keepLargestComponents', () => {
  it('keeps only the biggest blobs', () => {
    const w = 10, h = 3;
    const mask = new Uint8Array(w * h);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 3; y++) mask[y * w + x] = 255; // 15px
    mask[0 * w + 9] = 255; // 1px 雜點
    const out = keepLargestComponents(mask, w, h, 1, 2);
    expect(out[9]).toBe(0);
    expect(out[0]).toBe(255);
  });
});

describe('background detection', () => {
  const makeImage = (w, h, fill) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b, a] = fill(i % w, (i / w) | 0);
      data.set([r, g, b, a], i * 4);
    }
    return data;
  };

  it('estimates a white background', () => {
    const w = 20, h = 20;
    const data = makeImage(w, h, (x, y) =>
      (x > 5 && x < 15 && y > 5 && y < 15) ? [10, 10, 10, 255] : [255, 255, 255, 255]);
    expect(estimateBackgroundColor(w, h, data)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('flood fills the background but not the subject', () => {
    const w = 20, h = 20;
    const data = makeImage(w, h, (x, y) =>
      (x > 5 && x < 15 && y > 5 && y < 15) ? [10, 10, 10, 255] : [255, 255, 255, 255]);
    const visited = floodBackground(w, h, data, { r: 255, g: 255, b: 255 }, 70);
    expect(visited[0]).toBe(255);
    expect(visited[10 * w + 10]).toBe(0);
  });
});
