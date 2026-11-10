#!/usr/bin/env node
/**
 * app_check_v1.0.mjs — 本 repo 專用交付前閘門（a wrapper around the truth-repo checkers）
 *
 * 用法：
 *   node scripts/app_check_v1.0.mjs            # 文字報告
 *   node scripts/app_check_v1.0.mjs --json     # 機讀（CI artifact 用）
 *
 * 一個命令驗 8 組嘢：
 *   1. 單一 HTML 審計（S/F/A/W/V/C）— 直接 import scripts/audit_single_html_v1.0.mjs
 *   2. SEO／GEO 靜態檢查 — 直接 import scripts/seo_check_v1.0.mjs
 *   3. G11 九個圖標（存在、尺寸正確、總和 ≤ 260 KB）
 *   4. manifest 四個 icon ＋ og:image 絕對網址／1200×630 真檔
 *   5. 雙版號一致（APP_VERSION ＝ meta app-version ＝ package.json ＝ 頁尾）
 *   6. 執行期依賴 = 0（S3）
 *   7. dist 體積 ≤ 1 MB、單檔 ≤ 5MB（C13-g）
 *   8. 死檔／暫存檔零容忍（S4）
 *
 * 唯一「已記錄例外」：V1 檔名版號 —— Vercel 靜態站入口必須叫 index.html，
 * 唔可以叫 app_v1.1.0.html。只要四處版號一致，就降級做 INFO（詳見 README「版號」）。
 *
 * 退出碼：0 = 無 FAIL；1 = 有 FAIL。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { audit } from './audit_single_html_v1.0.mjs';
import { check as seoCheck } from './seo_check_v1.0.mjs';

const ROOT = process.cwd();
const out = [];
const add = (level, id, msg) => out.push({ level, id, msg });
const fail = (id, msg) => add('FAIL', id, msg);
const warn = (id, msg) => add('WARN', id, msg);
const pass = (id, msg) => add('PASS', id, msg);
const info = (id, msg) => add('INFO', id, msg);

const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const size = f => statSync(path.join(ROOT, f)).size;

/* ---------- 1＋2. 上游兩支檢查器 ---------- */
const html = read('index.html');
const auditResult = audit(html, 'index.html', size('index.html'));
const seoResult = seoCheck(html, 'index.html');

const pkg = JSON.parse(read('package.json'));
const appVer = (html.match(/APP_VERSION\s*=\s*['"]v?(\d+\.\d+(?:\.\d+)?)['"]/) || [])[1];
const metaVer = (html.match(/<meta\s+name=["']app-version["']\s+content=["']v?([\d.]+)["']/i) || [])[1];
const footerVer = (html.match(/<span id="appVersion">v?([\d.]+)<\/span>/) || [])[1];
const versionsAgree = appVer && metaVer && footerVer && appVer === metaVer && metaVer === footerVer && appVer === pkg.version;

for (const f of auditResult.findings) {
  const isFilenameWaiver = f.level === 'FAIL' && f.id === 'V1' && /檔名 index\.html 無/.test(f.msg);
  if (isFilenameWaiver && versionsAgree) {
    info('V4（已記錄例外）', `Vercel 入口固定叫 index.html（唔可以叫 app_v${appVer}.html）；版號已四處同步 v${appVer}：APP_VERSION／meta app-version／package.json／頁尾`);
  } else {
    add(f.level, f.id, f.msg);
  }
}
for (const f of seoResult.findings) add(f.level, f.id, f.msg);

/* ---------- 3. G11 圖標 ---------- */
const ICONS = [
  ['favicon.ico', null],
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-192.png', 192],
  ['icon-maskable-512.png', 512],
  ['og-image.png', 1200],
];
const readPngSize = file => {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
let iconTotal = 0;
let iconOk = true;
for (const [name, expected] of ICONS) {
  const file = path.join(ROOT, 'public/icons', name);
  if (!existsSync(file)) { fail('G11', `缺 public/icons/${name}`); iconOk = false; continue; }
  iconTotal += statSync(file).size;
  if (expected) {
    const dim = readPngSize(file);
    if (!dim) { fail('G11', `public/icons/${name} 唔係合法 PNG`); iconOk = false; }
    else if (dim[0] !== expected) { fail('G11', `public/icons/${name} 尺寸 ${dim[0]}×${dim[1]}，應為 ${expected}×${expected}`); iconOk = false; }
  }
}
if (iconOk) pass('G11', `9 個圖標齊、尺寸正確（合計 ${(iconTotal / 1024).toFixed(1)} KB ≤ 260 KB）`);
else if (iconTotal > 260 * 1024) fail('G11', `圖標合計 ${(iconTotal / 1024).toFixed(1)} KB > 260 KB — 減色，唔准換格式`);

/* ---------- 4. manifest ＋ og:image ---------- */
const manifestPath = path.join(ROOT, 'public/manifest.webmanifest');
if (!existsSync(manifestPath)) fail('G11/manifest', '缺 public/manifest.webmanifest');
else {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const icons = m.icons || [];
    const any512 = icons.some(i => i.sizes === '512x512' && /any/.test(i.purpose || 'any'));
    const mask512 = icons.some(i => i.sizes === '512x512' && /maskable/.test(i.purpose || ''));
    const missing = icons.filter(i => !existsSync(path.join(ROOT, 'public', i.src))).map(i => i.src);
    if (!any512 || !mask512) fail('G11/manifest', 'manifest 要 4 個 icon：any 192／any 512／maskable 192／maskable 512');
    else if (missing.length) fail('G11/manifest', `manifest 指向唔存在嘅檔：${missing.join(', ')}`);
    else if (!m.theme_color || !m.background_color) fail('G11/manifest', 'manifest 缺 theme_color／background_color');
    else pass('G11/manifest', `manifest 4 個 icon、theme_color=${m.theme_color}、display=${m.display}`);
  } catch (e) {
    fail('G11/manifest', `manifest 唔係合法 JSON：${e.message}`);
  }
}
const og = (html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) || [])[1];
if (!og) warn('G11/og', '無 og:image');
else if (!/^https:\/\//.test(og)) fail('G11/og', `og:image 必須絕對 https 網址（而家：${og}）`);
else if (!existsSync(path.join(ROOT, 'public', og.replace(/^https?:\/\/[^/]+/, '')))) fail('G11/og', `og:image 指向唔存在嘅本機檔：${og}`);
else {
  const dim = readPngSize(path.join(ROOT, 'public', og.replace(/^https?:\/\/[^/]+/, '')));
  if (dim && (dim[0] !== 1200 || dim[1] !== 630)) fail('G11/og', `og-image 應為 1200×630（而家 ${dim[0]}×${dim[1]}）`);
  else pass('G11/og', `og:image = ${og}（1200×630，絕對網址）`);
}
for (const f of ['robots.txt', 'sitemap.xml']) {
  if (existsSync(path.join(ROOT, 'public', f))) pass('SEO/public', `public/${f} 存在`);
  else warn('SEO/public', `缺 public/${f}`);
}

/* ---------- 5. 雙版號一致性 ---------- */
if (versionsAgree) pass('V1/V2', `版號四處一致：v${appVer}（APP_VERSION／meta／package.json／頁尾）`);
else fail('V1/V2', `版號唔一致：APP_VERSION=${appVer} · meta=${metaVer} · 頁尾=${footerVer} · package.json=${pkg.version}`);

/* ---------- 6. 執行期依賴 = 0 ---------- */
const runtimeDeps = Object.keys(pkg.dependencies || {});
if (runtimeDeps.length) fail('S3', `dependencies 應該係 0 個，而家有：${runtimeDeps.join(', ')}`);
else pass('S3', '執行期依賴 0 個（純前端單檔）');
if (/from\s+['"]@vercel\/analytics['"]/.test(html)) warn('S3', 'index.html 仍然 import @vercel/analytics — 應用零依賴 snippet');

/* ---------- 7. 體積 ---------- */
const distIndex = path.join(ROOT, 'dist');
if (existsSync(distIndex)) {
  let total = 0, files = 0;
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else { total += statSync(p).size; files++; }
    }
  };
  walk(distIndex);
  if (total > 1024 * 1024) fail('S7/G11', `dist ${(total / 1048576).toFixed(2)} MB > 1 MB（docs/33 §8）`);
  else pass('S7', `dist ${(total / 1024).toFixed(0)} KB / ${files} 檔 ≤ 1 MB`);
  if (size('index.html') > 5 * 1024 * 1024) fail('C13-g', 'index.html > 5MB');
} else {
  info('S7', '未 build（dist/ 不存在）— 跑 npm run build 後再驗');
}

/* ---------- 8. 死檔 ---------- */
const junk = [];
const walkRepo = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.vercel'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRepo(p);
    else if (/\.(bak|tmp|old|orig|swp|log)$/i.test(e.name) || /\(\d+\)\.(png|jpe?g|svg)$/i.test(e.name)) junk.push(path.relative(ROOT, p));
  }
};
walkRepo(ROOT);
if (junk.length) fail('S4', `發現暫存／重複檔：${junk.join(', ')}`);
else pass('S4', '無 *.bak／*.tmp／*.old／*.log／(1).png 類死檔');

/* ---------- 9. inline JS 語法（ESLint 設定只覆蓋 .ts，唔會睇 index.html） ---------- */
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/i.test(m[1]) && !/application\/ld\+json/i.test(m[1]));
let syntaxBad = false;
for (const [i, m] of inlineScripts.entries()) {
  try { new Function(m[2]); } catch (e) { fail('F/js', `inline <script> #${i + 1} 語法錯誤：${e.message}`); syntaxBad = true; }
}
if (!syntaxBad && inlineScripts.length) pass('F/js', `${inlineScripts.length} 段 inline JS 語法正確（補 ESLint 只驗 .ts 嘅盲點）`);

/* ---------- 10. HTML 引用嘅圖標／manifest 真係存在 ---------- */
const headRefs = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
  .filter(tag => /rel\s*=\s*["'](?:icon|apple-touch-icon|manifest)["']/i.test(tag))
  .map(tag => (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1])
  .filter(Boolean);
const missingRefs = headRefs.filter(h => !existsSync(path.join(ROOT, 'public', h.replace(/^\//, ''))));
if (missingRefs.length) fail('G11/link', `HTML 引用咗唔存在嘅檔：${missingRefs.join(', ')}`);
else pass('G11/link', `${headRefs.length} 個 icon／manifest 引用全部有實檔`);

/* ---------- 11. Tailwind 建置期 CSS（唔用 runtime CDN） ---------- */
const twPath = path.join(ROOT, 'public/tailwind.css');
if (!existsSync(twPath)) {
  fail('S7/css', '缺 public/tailwind.css — 跑 npm run css');
} else {
  const css = readFileSync(twPath, 'utf8');
  const bytes = Buffer.byteLength(css);
  if (bytes > 60 * 1024) fail('S7/css', `tailwind.css ${(bytes / 1024).toFixed(1)} KB > 60 KB 預算`);
  else pass('S7/css', `tailwind.css ${(bytes / 1024).toFixed(1)} KB（建置期編譯，取代 ~400 KB runtime CDN）`);

  if (/cdn\.tailwindcss\.com/.test(html)) fail('S7/css', 'index.html 仍然載入 cdn.tailwindcss.com — 應改為 /tailwind.css');
  else pass('S7/css', '無 runtime Tailwind CDN');

  // 覆蓋率：HTML／JS 用到的每個 utility 都要真係生成咗（自訂 class 由 <style> 定義，另計）
  // 自訂 class 可能定義在主 <style>、亦可能喺列印模板（template string）嘅 CSS 入面；
  // 用「HTML 內有冇出現 .classname」做判斷（utility 只會喺 CSS 檔出現）。
  const isCustom = t => html.includes('.' + t);
  const tokens = new Set();
  const feed = str => str.split(/\s+/).forEach(t => { if (t) tokens.add(t); });
  for (const m of html.matchAll(/class="([^"]*)"/g)) feed(m[1]);
  for (const m of html.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) for (const q of m[1].matchAll(/'([^']+)'/g)) feed(q[1]);
  for (const m of html.matchAll(/className\s*=\s*[`'"]([^`'"]*)/g)) feed(m[1]);
  const escSel = t => t.replace(/([\[\]:/%#.,()!+*~'"])/g, '\\$1');
  const used = [...tokens].filter(t => t && !t.includes('{') && !t.includes("'") && t !== ':' && t !== '?');
  const missing = used.filter(t => !isCustom(t) && !css.includes('.' + escSel(t)));
  if (missing.length) fail('S7/css', `${missing.length} 個 class 冇對應 CSS（Tailwind 掃唔到）：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
  else pass('S7/css', `${used.length} 個 class 全部有 CSS（${used.length - missing.length} 個 utility ＋ 自訂 class）`);
}

// 部署煙霧測試：.vercelignore 唔可以連建置必需品都排除（2026-11-10 真係咁樣炸過一次：
// src/ 被 ignore → Vercel 上面 npm run css 找唔到 src/tailwind.css → build fail）
if (existsSync('.vercelignore')) {
  const critical = ['index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tailwind.config.js', 'src/tailwind.css', 'public/', 'build-css.mjs', '.npmrc'];
  const rules = readFileSync('.vercelignore', 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const hidden = critical.filter(f => rules.some(r => f === r || f.startsWith(r.replace(/\/$/, '') + '/')));
  if (hidden.length) fail('S7/deploy', `.vercelignore 排除咗建置必要檔案：${hidden.join(', ')} — Vercel build 會 fail`);
  else pass('S7/deploy', '.vercelignore 冇排除建置必要檔案（src/tailwind.css、tailwind.config.js、build-css.mjs、.npmrc 會上傳）');
}

// 建置工具唔可以被略過（2026-11-10 真事故：建置環境 NODE_ENV=production → npm ci 依預設
// 略過 devDependencies → 冇 tailwindcss／vite／typescript → prebuild「tailwindcss: command not
// found」→ deploy fail。第一道防線 .npmrc include=dev，第二道 vercel.json installCommand。）
const cssScript = JSON.parse(read('package.json')).scripts?.css ?? '';
if (!/build-css\.mjs/.test(cssScript)) {
  fail('S7/devdeps', `package.json "css" 應為 node build-css.mjs（現時：${cssScript}）— 缺少缺套件時的保底處理`);
} else if (!existsSync(path.join(ROOT, 'build-css.mjs'))) {
  fail('S7/devdeps', '缺 build-css.mjs — npm run css／prebuild 會 fail');
} else if (!/^\s*include\s*=\s*dev\s*$/m.test(existsSync(path.join(ROOT, '.npmrc')) ? read('.npmrc') : '')) {
  fail('S7/devdeps', '.npmrc 缺 include=dev — NODE_ENV=production 時 npm ci 會略過 devDependencies（tailwindcss／vite／typescript），build 會 fail');
} else {
  const installCmd = existsSync(path.join(ROOT, 'vercel.json')) ? (JSON.parse(read('vercel.json')).installCommand ?? '') : '';
  if (!/--include=dev/.test(installCmd)) warn('S7/devdeps', `vercel.json installCommand 未寫 --include=dev（現時：${installCmd || '未設定'}）；.npmrc 已擋，屬第二道防線`);
  else pass('S7/devdeps', 'npm ci 會安裝 devDependencies（.npmrc include=dev ＋ vercel.json --include=dev），Tailwind 建置工具齊全');
}


/* ---------- 報告 ---------- */
const count = lvl => out.filter(f => f.level === lvl).length;
const ok = count('FAIL') === 0;
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ tool: 'app_check', version: 'v1.0', ok, counts: { FAIL: count('FAIL'), WARN: count('WARN'), PASS: count('PASS') }, findings: out }, null, 2));
} else {
  const icon = { FAIL: '✗', WARN: '!', PASS: '✓', INFO: '·' };
  console.log('\n本 repo 交付前閘門 v1.0 — index.html ＋ 圖標 ＋ 版號 ＋ 體積\n');
  for (const f of out) console.log(`  ${icon[f.level]} [${f.id}] ${f.msg}`);
  console.log(`\n${ok ? '✅ APP CHECK PASS' : '❌ APP CHECK FAIL'} — ${count('FAIL')} FAIL · ${count('WARN')} WARN · ${count('PASS')} PASS\n`);
}
process.exit(ok ? 0 : 1);
