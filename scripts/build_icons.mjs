#!/usr/bin/env node
/**
 * build_icons.mjs — 由 design/*.svg 母圖輸出 G11 九個圖標（PNG／ICO）
 *
 * 用法（sharp 只係一次性工具，刻意唔加入 package.json，避免 devDependencies 增肥）：
 *   npm i --no-save sharp
 *   node scripts/build_icons.mjs
 *
 * 輸出：public/icons/{favicon.ico, favicon-16.png, favicon-32.png,
 *                       apple-touch-icon.png, icon-192.png, icon-512.png,
 *                       icon-maskable-192.png, icon-maskable-512.png, og-image.png}
 * 規範來源：playerkousas-rgb/readme docs/33-icon-standard.md（G11）
 *   - 全部 PNG／ICO，唔用 SVG／WebP／AVIF
 *   - 9 個檔總和 ≤ 260 KB（減色，唔換格式）
 *   - maskable 主體收喺中央 66%；16px 另外手繪（design/favicon-16.svg）
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/icons');
const DESIGN = path.join(ROOT, 'design');
const read = f => readFileSync(path.join(DESIGN, f));

mkdirSync(OUT, { recursive: true });

const master = read('icon-master.svg');
const maskable = read('icon-maskable.svg');
const tiny = read('favicon-16.svg');
const og = read('og-image.svg');

/** @param {Buffer} svg @param {number} size @param {number} colours */
async function png(svg, size, colours, height = size) {
  return sharp(svg, { density: 72 })
    .resize(size, height, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: true, colours, effort: 10 })
    .toBuffer();
}

const files = [
  ['favicon-16.png', tiny, 16, 16, 16],
  ['favicon-32.png', master, 32, 32, 24],
  ['apple-touch-icon.png', master, 180, 180, 32],
  ['icon-192.png', master, 192, 192, 32],
  ['icon-512.png', master, 512, 512, 48],
  ['icon-maskable-192.png', maskable, 192, 192, 32],
  ['icon-maskable-512.png', maskable, 512, 512, 48],
  ['og-image.png', og, 1200, 630, 64],
];

for (const [name, svg, w, h, colours] of files) {
  const buf = await png(svg, w, colours, h);
  writeFileSync(path.join(OUT, name), buf);
  console.log(`  ✓ ${name.padEnd(24)} ${w}×${h}  ${(buf.length / 1024).toFixed(1)} KB`);
}

/* ---- favicon.ico：16／32／48 三合一，內部直接嵌 PNG（IE／書籤／舊瀏覽器都食） ---- */
const icoSizes = [16, 32, 48];
const icoPngs = [];
for (const s of icoSizes) icoPngs.push({ size: s, buf: await png(s === 16 ? tiny : master, s, s === 16 ? 16 : 32) });
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoPngs.length, 4);
let offset = 6 + 16 * icoPngs.length;
const entries = [];
for (const { size, buf } of icoPngs) {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4);   // planes
  e.writeUInt16LE(32, 6);  // bit depth
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += buf.length;
}
const ico = Buffer.concat([header, ...entries, ...icoPngs.map(p => p.buf)]);
writeFileSync(path.join(OUT, 'favicon.ico'), ico);
console.log(`  ✓ ${'favicon.ico'.padEnd(24)} 16/32/48  ${(ico.length / 1024).toFixed(1)} KB`);

/* ---- 驗收：總和 ≤ 260 KB（G11 §8） ---- */
const all = [...files.map(f => f[0]), 'favicon.ico'];
const total = all.reduce((n, f) => n + statSync(path.join(OUT, f)).size, 0);
console.log(`\n  9 個圖標合計 ${(total / 1024).toFixed(1)} KB（上限 260 KB）`);
if (total > 260 * 1024) {
  console.error('✗ 超標：減色或減尺寸，唔准換格式');
  process.exit(1);
}
if (existsSync(path.join(ROOT, 'public/favicon.svg'))) {
  rmSync(path.join(ROOT, 'public/favicon.svg'));
  console.log('  · 已移除舊 public/favicon.svg（G11 只准 PNG／ICO）');
}
