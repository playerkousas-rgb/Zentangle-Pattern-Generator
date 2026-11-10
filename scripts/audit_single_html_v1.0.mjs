#!/usr/bin/env node
/**
 * audit_single_html_v1.0.mjs — 單一 HTML / Gemini Canvas artifact 交付前審計
 *
 * 用法：
 *   node scripts/audit_single_html_v1.0.mjs <path-to.html>
 *   node scripts/audit_single_html_v1.0.mjs <path-to.html> --json
 *
 * 零 dependency（S1）。對照 S/F/A/W/V/C 規則，輸出可直接貼落 PR 嘅報告。
 * 退出碼：0 = 無 FAIL；1 = 有 FAIL（CI 可用）；2 = 用法錯。
 *
 * ★ 2026-10-27 用戶定案（C13-g）：
 *   單一 HTML / Gemini Canvas app 係**另一類交付物** —— 唔經 Vercel、唔使瘦身。
 *   S7（dist<5MB / bundle<2MB）同 S10（每檔<1MB）**唔適用**喺呢類。
 *   唯一硬上限 = Gemini Canvas **5MB**；其餘體積項目只做 INFO，唔判 FAIL。
 *
 * ★ 2026-10-27 用戶定案（C13）：
 *   「自動注入」唔係換 placeholder，係**已經實作、實測可用**嘅雙軌做法：
 *     ① 全檔唯一 `const API_KEY = ""` slot（平台可填入）；
 *     ② 平台請求代理：`credentials:'include'` + 冇 key 時唔加 `?key=`；
 *     ③ 本機／BYOK 後備：用戶自己入 key。
 *   呢個先係正確嘅注入方式；審計器只加固 ③ 嘅 key 傳遞方式，唔否定 ①②。
 *
 * 只係靜態審計，唔會執行個 HTML、唔會改檔、唔會上傳任何嘢。
 * 規則詳情：docs/16-canvas-case-scout-comic.md、docs/14-api-key-injection.md
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const VERSION = 'v1.0';

export const LIMIT_CANVAS = 5 * 1024 * 1024;   // C13-g：Gemini Canvas 單一 HTML 硬上限 5MB
const KEY_SHAPE = /AIza[0-9A-Za-z_-]{30,}/;

const findings = [];
const add = (level, id, msg) => findings.push({ level, id, msg });
const fail = (id, msg) => add('FAIL', id, msg);
const warn = (id, msg) => add('WARN', id, msg);
const pass = (id, msg) => add('PASS', id, msg);
const info = (id, msg) => add('INFO', id, msg);

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

export function audit(html, filename = 'app.html', bytes = Buffer.byteLength(html)) {
  findings.length = 0;   // 每次審計獨立（同一 process 連續 audit 唔好累積上一次結果）
  const visible = stripScripts(html);
  const lines = html.split('\n');
  let longest = 0, longestAt = 0;
  lines.forEach((l, i) => { if (l.length > longest) { longest = l.length; longestAt = i + 1; } });

  /* ---- C13-g：單一 HTML 只守 5MB（唔適用 Vercel 瘦身 S7/S10） ---- */
  if (bytes > LIMIT_CANVAS) {
    fail('C13-g', `單檔 ${(bytes / 1048576).toFixed(2)} MB > 5MB — 超 Gemini Canvas 上限；要拆圖做外置 URL／減 base64`);
  } else {
    pass('C13-g', `單檔 ${(bytes / 1048576).toFixed(2)} MB ≤ 5MB（Gemini Canvas 上限）— 唔使瘦身`);
  }
  info('C13-g/S', `最長一行 ${longest} chars（第 ${longestAt} 行）、${lines.length} 行 — 體積只做參考，唔判 FAIL；Canvas 編輯／載入卡住先考慮拆行`);

  const inlineImgs = (html.match(/data:image\/[a-z]+;base64/gi) || []).length;
  info('C13-g/S6', `${inlineImgs} 張 inline base64 圖 — 單一 HTML 可以用，唔使外置（除非超 5MB）`);

  const cdn = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)/gi)].map(m => m[1]);
  if (cdn.length) info('F/C13-g', `${cdn.length} 個外部 CDN（${[...new Set(cdn.map(u => new URL(u).host))].join(', ')}）— 斷網降級自己決定，唔係體積問題`);
  else pass('F/C13-g', '零外部 CDN 依賴');

  /* ---- C13：自動注入（用戶已實作、實測可用） ---- */
  const keyDecl = (html.match(/\b(?:const|let|var)\s+API_KEY\s*=/g) || []).length;
  const hasProxy = /credentials\s*:\s*['"]include['"]/.test(html);
  const hasByok = /sessionStorage|localStorage|keyPrompt|drawscout_api_key|scout_gemini_key/i.test(html);

  if (keyDecl === 0 && !hasProxy) {
    warn('C13', '未見唯一 API_KEY slot 或 credentials 代理 — 如果個 app 唔需要 AI 可以忽略');
  } else if (keyDecl > 1) {
    fail('C13/F', `${keyDecl} 處 API_KEY 宣告 — 要全檔唯一，否則平台注入會改錯位（你 VERSION_LOG 實測過）`);
  } else {
    pass('C13', `全檔 ${keyDecl} 處 API_KEY 宣告 = 平台注入 slot；保持唯一就啱`);
  }
  if (hasProxy) pass('C13', "credentials:'include' 已實作 = 平台請求代理加認證（已驗證可用嘅正確注入方式）");
  else info('C13', '無 credentials 代理（可能係零 key app／server-side 做法）');
  if (hasByok) info('C13', '有本機／BYOK 後備 key 來源（用戶自己入 key，離開 Canvas 都用得）');

  /* ---- A：key 保護 ---- */
  if (KEY_SHAPE.test(html)) fail('A1', '檔內有疑似真 Gemini API key — 即刻 rotate（docs/11-incidents.md）');
  else pass('A1', '檔內無真 key 形狀字串');

  // 只捉「真 code」：?key=${...} / ?key=' + key / ?key=AIza...；
  // 說明文字同註解入面嘅「?key=」唔算（避免自己份文件被自己判死刑）
  const URL_KEY_CODE = /\?key\s*=\s*(?:\$\{|['"][^'"]*['"]?\s*\+|['"]?AIza[0-9A-Za-z_-]{20,})/;
  if (URL_KEY_CODE.test(html)) {
    fail('A1/W6', 'BYOK 後備路徑將 key 放喺 URL query（?key=...）— 會落 log／history／referrer；淨係呢條路改做 x-goog-api-key header，平台注入／代理機制唔使改');
  } else pass('A1/W6', '無 key 落 URL query');

  if (/Object\.keys\(\s*window\s*\)/.test(html) && /AIza/.test(html)) {
    warn('A1', '掃描所有 window 全域變數搵 key — 可加固做只讀明確 slot；但唔影響你個注入機制運作');
  }
  if (/localStorage[^\n]*(?:api[_-]?key|gemini)/i.test(html) || /setItem\(\s*['"][^'"]*api[_-]?key/i.test(html)) {
    warn('A1/BYOK', 'API key 存 localStorage — 可選加固：sessionStorage／server-side secret（docs/14）；BYOK 本身唔係錯');
  }

  /* ---- W：版權 ---- */
  if (!/<meta\s+name=["']copyright["']/i.test(html)) fail('W1', '無 <meta name="copyright"> — 加 `© SCOUT SYSTEM`');
  else pass('W1', '有 copyright meta');
  if (!/©\s*SCOUT SYSTEM|Copyright Scout System/i.test(visible)) fail('W1', '可見頁面無 © SCOUT SYSTEM 版權標示');
  else pass('W1', '可見頁面有版權標示');

  const hasV1 = html.includes('DRAWSCOUT|v1');
  const hasV2 = html.includes('SCOUTSYSTEM|v2|');
  if (!hasV1 && !hasV2) warn('W2', '無隱形水印常數 — 出圖 app 應該嵌 DCT 水印（docs/12）');
  else if (hasV1 && !hasV2) warn('W2/W5', '只有 v1 payload（DRAWSCOUT|v1）— 可選升 v2（單位＋日期＋hash）；v1 解碼器仍向後兼容');
  else pass('W2/W5', '有 v2 payload 水印');

  /* ---- V：雙版號 ---- */
  let fn = path.basename(filename).match(/_v(\d+\.\d+(?:\.\d+)?)(?=[._-]|$)/);
  // V4 例外：Apps Script / Canvas 部署拷貝一定要叫 index.html / Code.gs，
  // 只要檔頭有 sync 產生嘅 GENERATED from <versioned source> 標記，就當佢有版號。
  const generated = html.match(/GENERATED from\s+(\S+_v(\d+\.\d+(?:\.\d+)?)\.\w+)\s*\(v[\d.]+\)/);
  if (!fn && generated) {
    fn = [null, generated[2]];
    info('V4', `部署拷貝 ${path.basename(filename)} 由 ${generated[1]} sync 產生 — 版本化源檔先係 Git 真理`);
  }
  const appVer = (html.match(/APP_VERSION\s*=\s*['"]v?(\d+\.\d+(?:\.\d+)?)['"]/) || [])[1];
  if (!fn) fail('V1', `檔名 ${path.basename(filename)} 無 _vX.Y 版號 — 每次更新檔名＋內文要同步改`);
  else pass('V1', `檔名／部署拷貝版號 v${fn[1]}`);
  if (!appVer) fail('V2', '無 APP_VERSION 常數 — 內文版號無單一真理');
  else info('V2', `APP_VERSION = v${appVer}`);
  if (!/<meta\s+name=["']app-version["']/i.test(html)) fail('V2', '無 <meta name="app-version"> — 至少要 meta／title／檔頭／常數／頁尾四處');
  else pass('V2', '有 app-version meta');

  if (fn && appVer && fn[1] !== appVer) fail('V1', `檔名 v${fn[1]} ≠ APP_VERSION v${appVer}`);
  const staticVers = [...new Set((visible.match(/v\d+\.\d+(?:\.\d+)?/g) || []))];
  const stale = staticVers.filter(v => appVer && v !== `v${appVer}`);
  if (stale.length) fail('V1/V3', `靜態 HTML 有舊版號 ${stale.join(', ')}（APP_VERSION v${appVer}）— JS 未開機／開機守衛攔截時用戶會見到錯版`);
  else if (appVer) pass('V1/V3', `靜態 HTML 版號一致（v${appVer}）`);

  /* ---- C：結構 ---- */
  if (/systemPrompt|buildPagePrompt|SYSTEM_PROMPT/i.test(html) && !/google\.script\.run/.test(html)) {
    warn('C9/A', 'PROMPT 寫咗喺前端 JS — 「檢視原始碼」睇到；要保密就轉 Type C 腦殼分離（Code.gs），但 Type B 咁做係正常');
  }
  if (!/google\.script\.run|appendRecord|RECORDS/i.test(html)) {
    info('C10', '無 server-side 使用紀錄／原圖成品圖存檔 — Type B 交付可接受，但要喺 README 講明限制（W5）');
  }
  if (/localStorage/.test(html) && !/try\s*\{/.test(html)) {
    warn('F', '有用 localStorage 但無 try/catch — Canvas sandbox 會直接拋錯令全 app 停擺（你 VERSION_LOG 實測過）');
  } else if (/safeStore|try\s*\{[^{}]*localStorage/.test(html)) {
    pass('F', 'localStorage 有安全包裝（sandbox 唔會炸）');
  }

  return { file: filename, bytes, lines: lines.length, findings };
}

/* ---- CLI ---- */
const isCli = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.basename(new URL(import.meta.url).pathname));
if (isCli) {
  const file = process.argv[2];
  if (!file) {
    console.log('用法：node scripts/audit_single_html_v1.0.mjs <path-to.html> [--json]');
    process.exit(2);
  }
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { console.error(`讀唔到 ${file}：${e.message}`); process.exit(2); }
  const r = audit(html, file, statSync(file).size);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const icon = { FAIL: '✗', WARN: '!', PASS: '✓', INFO: '·' };
    console.log(`\n單一 HTML 審計 ${VERSION} — ${r.file}`);
    console.log(`C13-g：5MB 上限（唔經 Vercel、唔使瘦身）· ${r.lines} 行 · S/F/A/W/V/C 對照\n`);
    for (const f of r.findings) console.log(`  ${icon[f.level]} [${f.id}] ${f.msg}`);
    const n = r.findings.filter(f => f.level === 'FAIL').length;
    const w = r.findings.filter(f => f.level === 'WARN').length;
    console.log(`\n${n ? `❌ AUDIT FAIL — ${n} 項要修（${w} 個警告）` : `✅ AUDIT PASS — 0 FAIL（${w} 個警告）`}`);
    console.log('對照案例：docs/16-canvas-case-scout-comic.md\n');
  }
  process.exit(r.findings.some(f => f.level === 'FAIL') ? 1 : 0);
}
