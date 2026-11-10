#!/usr/bin/env node
/**
 * build-css.mjs — `npm run css` 的入口（Tailwind 建置期編譯）
 *
 * 為何唔直接寫 `tailwindcss -c ...`？
 *   2026-11-10 部署事故：建置環境 NODE_ENV=production，
 *   `npm ci` 略過 devDependencies → node_modules/.bin/tailwindcss 唔存在 →
 *   prebuild 直接「tailwindcss: command not found」→ 整個 deploy fail。
 *
 * 策略（保住「唔會莫名其妙死」，又唔會靜靜雞出錯）：
 *   1. 搵得到 Tailwind CLI → 照正常編譯；編譯失敗就照樣 fail（唔可以扮成功）。
 *   2. 搵唔到 CLI，但 public/tailwind.css 存在（已 commit 的建置產物）
 *      → 大聲警告並沿用該檔，令 deploy 唔會因為環境缺 devDependency 而死。
 *      （設 TAILWIND_STRICT=1 可強制要求真編譯；CI 的 build 步驟會設，
 *        確保「CSS 過期」永遠在 PR 就被攔住。）
 *   3. 兩樣都冇 → fail，並講清楚要點補救。
 *
 * 用法：
 *   node build-css.mjs              # npm run css
 *   TAILWIND_STRICT=1 node build-css.mjs   # 缺 CLI 即 fail（CI 用）
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'public/tailwind.css');
const ARGS = ['-c', 'tailwind.config.js', '-i', 'src/tailwind.css', '-o', 'public/tailwind.css', '--minify'];
const STRICT = Boolean(process.env.TAILWIND_STRICT);

const log = msg => console.log(`[css] ${msg}`);
const warn = msg => console.warn(`[css] ⚠️  ${msg}`);

/** 搵 Tailwind CLI：先靠 module 解析（跨平台），再退回 node_modules/.bin */
function findCli() {
  try {
    // tailwindcss@3 的 bin 指向 lib/cli.js（package.json 冇 exports 封鎖）
    const resolved = createRequire(import.meta.url).resolve('tailwindcss/lib/cli.js');
    if (existsSync(resolved)) return resolved;
  } catch {
    /* 未安裝 tailwindcss：落去 .bin 試一次 */
  }
  const bin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
  return existsSync(bin) ? bin : null;
}

/** 建置工具鏈有冇齊（npm run build 除咗 CSS 仲要 tsc -b ＋ vite build） */
function missingToolchain() {
  const need = ['typescript/bin/tsc', 'vite/bin/vite.js'];
  const bin = t => path.join(ROOT, 'node_modules', t);
  return need.filter(t => !existsSync(bin(t))).map(t => t.split('/')[0]);
}

/** 建置產物最低限度嘅健全檢查（防止「空檔／垃圾檔」被當成成功） */
function precompiledCssProblem() {
  if (!existsSync(OUT)) return 'public/tailwind.css 唔存在';
  const bytes = statSync(OUT).size;
  if (bytes < 1024) return `public/tailwind.css 只有 ${bytes} bytes，似係損壞`;
  if (!readFileSync(OUT, 'utf8').includes('--tw-')) return 'public/tailwind.css 內冇 Tailwind 產物特徵（--tw-*）';
  return null;
}

const cli = findCli();

if (cli) {
  log(`用 ${path.relative(ROOT, cli)} 編譯（tailwind.config.js → public/tailwind.css）`);
  // 用 .cmd 時要靠 shell；其餘情況直接以 node 執行，避免 shebang／權限問題
  const useShell = cli.endsWith('.cmd');
  const res = useShell
    ? spawnSync(cli, ARGS, { cwd: ROOT, stdio: 'inherit', shell: true })
    : spawnSync(process.execPath, [cli, ...ARGS], { cwd: ROOT, stdio: 'inherit' });
  if (res.error) {
    console.error(`[css] ✗ 無法執行 Tailwind CLI：${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    // 真編譯錯誤（config 壞、class 語法錯…）→ 必須紅燈，唔可以偷偷沿用舊 CSS
    console.error(`[css] ✗ Tailwind 編譯失敗（exit ${res.status}）`);
    process.exit(res.status ?? 1);
  }
  log(`✓ 完成（${(statSync(OUT).size / 1024).toFixed(1)} KB）`);
  process.exit(0);
}

/* ---------- 搵唔到 CLI ---------- */
const reason = '搵唔到 Tailwind CLI（node_modules 冇 tailwindcss：devDependencies 被略過，通常係 NODE_ENV=production 的 npm ci）';

if (STRICT) {
  console.error(`[css] ✗ ${reason}`);
  console.error('[css]   TAILWIND_STRICT=1，唔准沿用舊 CSS。請先 npm ci --include=dev。');
  process.exit(1);
}

const problem = precompiledCssProblem();
if (problem) {
  console.error(`[css] ✗ ${reason}`);
  console.error(`[css]   而且冇可沿用嘅建置產物：${problem}`);
  console.error('[css]   補救：npm ci --include=dev（或 npm ci）後再 npm run css');
  process.exit(1);
}

// CSS 可以沿用，但成個 build 仲要 tsc -b ＋ vite build；工具鏈唔齊就早啲講清楚，
// 唔好等下一步爆一句「tsc: not found」（2026-11-10 部署事故的同一個根因）。
const missing = missingToolchain();
if (missing.length) {
  console.error(`[css] ✗ ${reason}`);
  console.error(`[css]   建置工具鏈同樣唔齊（缺 ${missing.join('、')}），tsc -b／vite build 一定 fail。`);
  console.error('[css]   補救：npm ci --include=dev（或確認平台安裝命令帶 --include=dev）');
  process.exit(1);
}

warn(reason);
warn(`沿用已 commit 的 public/tailwind.css（${(statSync(OUT).size / 1024).toFixed(1)} KB），deploy 繼續。`);
warn('若改過 index.html 的 class，本機請跑 npm run css 重新生成並 commit。');
process.exit(0);
