#!/usr/bin/env node
/**
 * e2e.mjs — 真 Chromium 端到端實測（建議 1：真機／視覺回歸）
 *
 * 為什麼要有：本 repo 的 canvas 管線（去背 → 分區 → 填圖案 → 水印 → 匯出）
 * 係靜態檢查同 jsdom 都驗唔到嘅。呢支會用真 Chromium 行一次完整流程，
 * 順便影 390／768／1440 截圖做人手視覺回歸。
 *
 * 用法：
 *   npm run build
 *   npm run test:e2e                      # 會自己開 vite preview（需先 build）
 *   BASE_URL=https://... npm run test:e2e # 直接測部署
 *   CHROME_PATH=/path/to/chrome npm run test:e2e
 *
 * 產物：artifacts/*.png（截圖）、artifacts/downloads/*（PNG／SVG）
 * 退出碼：0 = 全部 PASS；1 = 有 FAIL。
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const ART = path.join(ROOT, 'artifacts');
const DL = path.join(ART, 'downloads');
const PORT = process.env.PORT || 4173;
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

const CHROME = process.env.CHROME_PATH || [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => existsSync(p));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

if (!CHROME) {
  console.error('✗ 搵唔到 Chrome。請設定 CHROME_PATH=/path/to/chrome');
  process.exit(2);
}
if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('✗ 未 build。請先 npm run build');
  process.exit(2);
}

/* ---------- 起 preview server（除非外面已經有 BASE_URL） ---------- */
let server = null;
if (!process.env.BASE_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', detached: false,
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(BASE + '/'); up = r.ok; } catch { await delay(250); }
  }
  if (!up) { console.error('✗ preview server 起唔到'); server.kill(); process.exit(2); }
}

async function waitDownload(ext, before) {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const list = readdirSync(DL).filter(f => f.endsWith(ext) && !before.includes(f));
    if (list.length) { await delay(400); return path.join(DL, list[0]); }
    await delay(200);
  }
  throw new Error(`等唔到 ${ext} 下載`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
});

let exitCode = 1;
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 部署環境先有嘅分析 script，喺 preview 會 404；字型／網絡雜訊唔算 app 錯
    if (/_vercel\/insights|Failed to load resource|net::ERR|fonts\.g/i.test(t)) return;
    pageErrors.push(`console: ${t}`);
  });

  const client = await page.createCDPSession();
  try {
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  } catch {
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  }

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });

  /* ---------- 靜態／樣式 ---------- */
  const items = await page.$$eval('.pattern-item', els => els.length);
  check('圖案格 46 個（45 款 + 空白）', items === 46, String(items));
  const ver = await page.$eval('#appVersion', el => el.textContent.trim());
  check('頁尾版號由 APP_VERSION 寫入', ver === 'v1.2.0', ver);
  const gradient = await page.$eval('.btn-primary', el => getComputedStyle(el).backgroundImage);
  check('Tailwind 建置期 CSS 生效（btn-primary 漸變）', /gradient/.test(gradient), gradient.slice(0, 48));
  const twScript = await page.evaluate(() => [...document.scripts].some(s => /tailwindcss\.com/.test(s.src)));
  check('冇 runtime Tailwind CDN', twScript === false);
  const h1 = await page.$$eval('h1', els => els.length);
  check('一頁一個 h1', h1 === 1, String(h1));
  await page.screenshot({ path: path.join(ART, '01-home-1440.png') });

  /* ---------- 上載 → 生成 ---------- */
  const input = await page.$('#fileInput');
  await input.uploadFile(path.join(ROOT, 'tests/fixtures/silhouette.png'));
  await page.waitForFunction(() => {
    const c = document.getElementById('mainCanvas');
    if (!c || c.style.display === 'none' || !c.width) return false;
    const o = document.getElementById('processingOverlay');
    if (!o || getComputedStyle(o).display !== 'none') return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200) ink++;
    return ink > 40;
  }, { timeout: 180000, polling: 500 });

  const canvasInfo = await page.evaluate(() => {
    const c = document.getElementById('mainCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { total++; if (d[i] < 200) dark++; }
    return { w: c.width, h: c.height, inkRatio: dark / total };
  });
  check('生成出有墨線嘅作品', canvasInfo.inkRatio > 0.05, `${canvasInfo.w}×${canvasInfo.h} · ink ${(canvasInfo.inkRatio * 100).toFixed(1)}%`);

  const preview = await page.$('#previewCard');
  await preview.screenshot({ path: path.join(ART, '02-result-1440.png') });
  await page.screenshot({ path: path.join(ART, '03-result-full-1440.png'), fullPage: true });

  /* ---------- 圖鑑／指南／列印 ---------- */
  await page.click('#atlasBtn');
  await page.waitForSelector('#atlasModal.active', { timeout: 5000 });
  await delay(600);
  const atlas = await page.$$eval('#atlasGrid .atlas-item', els => els.length);
  check('圖鑑 45 款', atlas === 45, String(atlas));
  await page.screenshot({ path: path.join(ART, '04-atlas-1440.png') });
  await page.keyboard.press('Escape');

  await page.click('#guideBtn');
  await page.waitForSelector('#guideModal.active', { timeout: 5000 });
  await page.screenshot({ path: path.join(ART, '05-guide-1440.png') });
  await page.keyboard.press('Escape');

  await page.click('#printBtn');
  await page.waitForSelector('#printMenu.active', { timeout: 5000 });
  await page.screenshot({ path: path.join(ART, '06-print-menu.png') });
  await page.keyboard.press('Escape');

  /* ---------- 匯出 SVG 線稿 ---------- */
  const beforeSvg = readdirSync(DL);
  await page.click('#svgBtn');
  const svgFile = await waitDownload('.svg', beforeSvg);
  const svg = readFileSync(svgFile, 'utf8');
  check('SVG 有 XML 頭同 viewBox', svg.startsWith('<?xml') && /viewBox="0 0 \d+ \d+"/.test(svg));
  check('SVG 有向量路徑', (svg.match(/<path /g) || []).length > 3, `${(svg.match(/<path /g) || []).length} 條`);
  check('SVG 寫入版權', /SCOUT SYSTEM/.test(svg));
  check('SVG 冇內嵌點陣圖', !/data:image\//.test(svg));
  check('SVG 體積合理（< 1.5 MB）', readFileSync(svgFile).length < 1.5 * 1024 * 1024, `${(readFileSync(svgFile).length / 1024).toFixed(0)} KB`);

  /* ---------- 下載 PNG：tEXt ＋ 隱形水印 ---------- */
  const beforePng = readdirSync(DL);
  await page.click('#downloadBtn');
  const pngFile = await waitDownload('.png', beforePng);
  const pngBuf = readFileSync(pngFile);
  check('PNG 有 tEXt 版權中繼資料', pngBuf.includes(Buffer.from('tEXtCopyright')));
  const dataUrl = 'data:image/png;base64,' + pngBuf.toString('base64');
  const wm = await page.evaluate(async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return window.wmDecode({ data: d.data, width: c.width, height: c.height });
  }, dataUrl);
  check('PNG 隱形水印讀得返（v2）', wm.found && wm.version === 'v2' && wm.unit === 'ZTNG',
    `${wm.payload || '(none)'} · confidence ${Number(wm.confidence).toFixed(2)}`);

  // 失敗時要睇得到係「codec 問題」定「檔案問題」
  if (!wm.found) {
    const diag = await page.evaluate(async src => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const hex = str => Array.from(str.slice(0, 12), ch => ch.charCodeAt(0).toString(16)).join(' ');
      const file = window.wmDecode({ data: d.data, width: c.width, height: c.height });
      const mc = document.getElementById('mainCanvas');
      const mctx = mc.getContext('2d', { willReadFrequently: true });
      const md = mctx.getImageData(0, 0, mc.width, mc.height);
      const tmp = new Uint8ClampedArray(md.data);
      window.wmEmbed({ data: tmp, width: mc.width, height: mc.height }, 'SCOUTSYSTEM|v2|ZTNG|20260101|ABCD');
      const codec = window.wmDecode({ data: tmp, width: mc.width, height: mc.height });
      return {
        file: { w: c.width, h: c.height, blocks: file.blocks, conf: +file.confidence.toFixed(3), hex: hex(file.payload) },
        canvas: { w: mc.width, h: mc.height },
        codec: { found: codec.found, payload: codec.payload, conf: +codec.confidence.toFixed(3) },
        px: [d.data[0], d.data[1], d.data[2], d.data[3], md.data[0], md.data[1], md.data[2]]
      };
    }, dataUrl);
    console.log('::notice title=e2e-diag::' + JSON.stringify(diag));
  }

  /* ---------- 作品集（IndexedDB） ---------- */
  await page.click('#galleryBtn');
  await page.waitForSelector('#galleryModal.active', { timeout: 5000 });
  await page.click('#gallerySaveBtn');
  await page.waitForFunction(() => document.getElementById('galleryCount').textContent.trim() === '1', { timeout: 15000 })
    .catch(() => {});
  const badge = await page.$eval('#galleryCount', el => el.textContent.trim());
  check('儲存到作品集（badge = 1）', badge === '1', badge);
  await page.keyboard.press('Escape');

  /* ---------- 響應式截圖（人手視覺回歸用） ---------- */
  for (const [w, h, name] of [[768, 1024, '07-tablet-768'], [390, 844, '08-mobile-390']]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await delay(500);
    await page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });
  }

  /* ---------- JS 錯誤 ---------- */
  check('冇未處理 JS 錯誤', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  const failed = results.filter(r => !r.ok);
  for (const f of failed) console.log(`::error title=e2e::${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  console.log(`::notice title=e2e::${results.length - failed.length}/${results.length} 通過`);
  console.log(`\n${failed.length ? '❌ E2E FAIL' : '✅ E2E PASS'} — ${results.length - failed.length}/${results.length} 通過`);
  console.log(`截圖：${path.relative(ROOT, ART)}/*.png · 下載：${path.relative(ROOT, DL)}/`);
  exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error('\n✗ E2E 執行出錯：', err && err.stack ? err.stack : err);
  const msg = String((err && err.message) || err).replace(/\n/g, ' ').slice(0, 400);
  console.log(`::error title=e2e-exception::${msg}`);
  for (const r of results.filter(x => !x.ok)) console.log(`::error title=e2e::${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  if (server) server.kill();
}

process.exit(exitCode);
