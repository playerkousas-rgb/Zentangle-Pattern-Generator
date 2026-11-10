#!/usr/bin/env node
/**
 * seo_check_v1.0.mjs — 公開頁面 SEO／GEO 靜態檢查（上線前自查）
 *
 * 用法：
 *   node scripts/seo_check_v1.0.mjs <path-to.html>
 *   node scripts/seo_check_v1.0.mjs <path-to.html> --json
 *
 * 零 dependency（S1）。靈感來自 Claude SEO（docs/37 §3）嘅「技術 SEO＋GEO 清單」，
 * 但呢支只做**唔使網絡、唔使 API key 都驗到**嗰部分：title／description／
 * canonical／Open Graph／JSON-LD／h1／img alt／lang／viewport。
 * 驗唔到嗰啲（Core Web Vitals 真分數、Google 收錄狀態、排名、AI 引用率）
 * 唔會扮驗到——嗰啲要 Search Console／PageSpeed／人手判斷，見 docs/39 §3。
 *
 * 適用：公開、想畀搜尋引擎搵到嘅頁面（Vercel 靜態站、Next.js 匯出頁、公開 HTML）。
 * 唔適用：要登入嘅系統、用完即棄嘅 Canvas 工具——嗰啲唔靠搜尋食飯，唔好為佢哋做 SEO 工程。
 * 只係靜態檢查，唔會執行個 HTML、唔會改檔、唔會上傳任何嘢。
 * 退出碼：0 = 無 FAIL；1 = 有 FAIL（CI 可用）；2 = 用法錯。
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const VERSION = 'v1.0';

const findings = [];
const add = (level, id, msg) => findings.push({ level, id, msg });
const fail = (id, msg) => add('FAIL', id, msg);
const warn = (id, msg) => add('WARN', id, msg);
const pass = (id, msg) => add('PASS', id, msg);
const info = (id, msg) => add('INFO', id, msg);

// 喺 <head>（或者成個檔）搵 meta content；name/property 大小寫唔計
function metaContent(html, key) {
  const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
}

function tagText(html, tag) {
  return html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
}

export function check(html, filename = 'index.html') {
  findings.length = 0; // 每次檢查獨立，唔累積上一次結果
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;

  /* ---- 基本：搜尋引擎認唔認到呢頁係乜 ---- */
  const title = tagText(head, 'title');
  if (!title) fail('SEO/title', '冇 <title>，或者係空——搜尋結果會冇標題');
  else if (title.length > 60) warn('SEO/title', `<title> 有 ${title.length} 字（>60），搜尋結果可能會畀人截斷`);
  else pass('SEO/title', `<title> 有（${title.length} 字）`);

  const desc = metaContent(head, 'description');
  if (!desc) fail('SEO/description', '冇 meta description——搜尋引擎會亂摘內文做摘要');
  else if (desc.length > 160) warn('SEO/description', `meta description 有 ${desc.length} 字（>160），可能會畀人截斷`);
  else if (desc.length < 50) warn('SEO/description', `meta description 得 ${desc.length} 字（<50），可能太空泛`);
  else pass('SEO/description', `meta description 有（${desc.length} 字）`);

  const charset = /<meta\b[^>]*charset/i.test(head);
  if (!charset) warn('SEO/charset', '冇 charset 宣告，中文有機會亂碼畀搜尋引擎誤讀');
  const viewport = metaContent(head, 'viewport');
  if (!viewport) warn('SEO/viewport', '冇 viewport meta，手機版面同流動優先收錄會出事');
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!lang) warn('SEO/lang', '冇 <html lang>，搜尋引擎估唔到頁面語言（我哋多數應該係 zh-Hant）');
  else pass('SEO/lang', `html lang="${lang}"`);

  const robots = metaContent(head, 'robots');
  if (robots && /noindex/i.test(robots)) warn('SEO/robots', `meta robots 係 "${robots}"——含 noindex 即係叫搜尋引擎唔好收錄，公開頁要確認係咪故意`);
  else info('SEO/robots', robots ? `meta robots="${robots}"` : '冇 meta robots（預設 index, follow）');

  /* ---- 分享同 AI 引用：畀人／AI 拎去用嗰陣齊唔齊 ---- */
  const canonical = head.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0];
  const canonicalHref = canonical?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!canonicalHref) warn('GEO/canonical', '冇 canonical 連結，同一內容多條 URL 會分散收錄');
  else if (!/^https?:\/\//i.test(canonicalHref)) warn('GEO/canonical', `canonical 唔係絕對網址（${canonicalHref}），要用 https:// 開頭嘅完整網址`);
  else pass('GEO/canonical', `canonical = ${canonicalHref}`);

  for (const og of ['og:title', 'og:description', 'og:image']) {
    const v = metaContent(head, og);
    if (!v) warn('GEO/og', `冇 ${og}——分享去社交／通訊軟件嗰陣預覽會殘缺`);
  }
  const ogImage = metaContent(head, 'og:image');
  if (ogImage && !/^https?:\/\//i.test(ogImage)) warn('GEO/og', `og:image 唔係絕對網址（${ogImage}），大部分平台會唔顯示`);
  if (metaContent(head, 'og:title') && metaContent(head, 'og:description') && ogImage) pass('GEO/og', 'og:title／og:description／og:image 齊');

  if (!metaContent(head, 'twitter:card')) info('GEO/twitter', '冇 twitter:card（X 分享預覽會用返 og 頂住，未必出事）');

  /* ---- 結構化資料：AI 搜尋最鍾意引用嗰部分 ---- */
  const ldBlocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  if (!ldBlocks.length) warn('GEO/jsonld', '冇 JSON-LD 結構化資料——想畀 Google AI／ChatGPT 引用嗰啲頁，呢樣係最平嘅加分位');
  for (const [i, block] of ldBlocks.entries()) {
    try {
      const data = JSON.parse(block);
      const type = data['@type'] || data['@graph']?.[0]?.['@type'] || '(冇 @type)';
      pass('GEO/jsonld', `JSON-LD #${i + 1} 解析到，@type = ${type}`);
    } catch (e) {
      fail('GEO/jsonld', `JSON-LD #${i + 1} 唔係合法 JSON（${e.message}），畀搜尋引擎會成段唔用`);
    }
  }

  /* ---- 內文結構 ---- */
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  if (!h1s.length) warn('SEO/h1', '冇 <h1>，頁面主題要靠估');
  else if (h1s.length > 1) warn('SEO/h1', `有 ${h1s.length} 個 <h1>，一頁一個主題先最清晰`);
  else pass('SEO/h1', `<h1> 一個：「${h1s[0].slice(0, 40)}」`);

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const noAlt = imgs.filter(t => !/alt\s*=\s*["'][^"']*["']/i.test(t)).length;
  if (imgs.length && noAlt) warn('SEO/alt', `${imgs.length} 張 <img> 入面有 ${noAlt} 張冇 alt，圖片搜尋同無障礙都蝕`);
  else if (imgs.length) pass('SEO/alt', `${imgs.length} 張 <img> 全部有 alt`);

  info('LIMIT', '呢支只驗靜態標記；效能分數／收錄狀態／AI 引用率驗唔到，要 PageSpeed＋Search Console＋人手判斷（docs/39 §3）');

  return { file: filename, findings, ok: !findings.some(f => f.level === 'FAIL') };
}

/* ---- CLI ---- */
const isCli = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.basename(new URL(import.meta.url).pathname));
if (isCli) {
  const file = process.argv[2];
  if (!file) {
    console.log('用法：node scripts/seo_check_v1.0.mjs <path-to.html> [--json]');
    process.exit(2);
  }
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { console.error(`讀唔到 ${file}：${e.message}`); process.exit(2); }
  const r = check(html, file);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const icon = { FAIL: '✗', WARN: '!', PASS: '✓', INFO: '·' };
    console.log(`\nSEO/GEO 靜態檢查 ${VERSION} — ${r.file}\n`);
    for (const f of r.findings) console.log(`  ${icon[f.level]} [${f.id}] ${f.msg}`);
    const n = r.findings.filter(f => f.level === 'FAIL').length;
    const w = r.findings.filter(f => f.level === 'WARN').length;
    console.log(`\n${n ? `❌ SEO CHECK FAIL — ${n} 項要修（${w} 個警告）` : `✅ SEO CHECK PASS — 0 FAIL（${w} 個警告）`}\n`);
  }
  process.exit(r.ok ? 0 : 1);
}
