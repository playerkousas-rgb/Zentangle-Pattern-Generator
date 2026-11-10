/**
 * 隱形水印 codec 測試（W2/W3/W5）
 *
 * 唔會另抄一份 codec —— 直接由 index.html 的兩個 marker 抽出**實際出貨嘅程式碼**，
 * 喺 Node 用合成影像做 embed → decode round-trip。所以「測試綠」＝「瀏覽器跑嘅同一段碼綠」。
 *
 * 執行：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ ===== <watermark-codec> =====([\s\S]*?)\/\/ ===== <\/watermark-codec> =====/);
assert.ok(block, 'index.html 找不到 watermark-codec markers');

const codec = new Function(`${block[1]}
  return { wmEmbed, wmDecode, wmMakePayloadV2, wmToBits, WM_MARK_V1, WM_PREFIX_V2 };`)();

/** 可重現嘅測試影像：平滑漸變 + 輕微紋理（太均勻嘅圖會令 DCT 係數全部貼近 0） */
function makeImage(w = 320, h = 240, seed = 1) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = 40 + 120 * (x / w) + 40 * (y / h);
      const n = (rnd() - 0.5) * 24;
      data[i] = base + n;
      data[i + 1] = base * 0.95 + n;
      data[i + 2] = base * 0.9 + n;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const clone = img => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

/**
 * 同真實匯出一樣嘅圖：純白底 + 深色筆觸（大面積 255 冇 headroom）。
 * 呢個 case 係 e2e 捉到嘅 regression：舊版只向上推係數，白色區全部 clip，
 * 結果成張圖解碼出嚟變晒 NUL。
 */
function makeLineArt(w = 600, h = 600) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = (x, y, v) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
  };
  // 同心圓 + 對角曲線，模擬禪繞筆觸
  for (let t = 0; t < 2400; t++) {
    const a = t / 2400 * Math.PI * 2;
    for (const r of [90, 130, 170, 210, 250]) {
      ink(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 20);
      ink(w / 2 + Math.cos(a * 3) * r * 0.6, h / 2 + Math.sin(a * 2) * r * 0.6, 60);
    }
  }
  for (let i = 0; i < 300; i++) ink(i * 2, i * 2, 10);
  return { data, width: w, height: h };
}

test('W2：v2 payload round-trip（unit／date／hash 讀得返）', () => {
  const img = makeImage();
  const payload = codec.wmMakePayloadV2({ unit: 'ZTNG', date: '20261110', hash: 'A1B2' });
  assert.equal(payload, 'SCOUTSYSTEM|v2|ZTNG|20261110|A1B2');
  assert.equal(payload.length, 33);

  codec.wmEmbed(img, payload);
  const d = codec.wmDecode(img);
  assert.equal(d.found, true, `應該讀到（confidence=${d.confidence}）`);
  assert.equal(d.payload, payload);
  assert.equal(d.version, 'v2');
  assert.equal(d.unit, 'ZTNG');
  assert.equal(d.date, '20261110');
  assert.equal(d.hash, 'A1B2');
});

test('W3：向後兼容 v1 MARK（舊解碼器／舊圖互通）', () => {
  const img = makeImage(320, 240, 7);
  codec.wmEmbed(img, 'DRAWSCOUT|v1');
  const d = codec.wmDecode(img);
  assert.equal(d.found, true);
  assert.equal(d.version, 'v1');
  assert.equal(d.payload, 'DRAWSCOUT|v1');
});

test('W2：白底線稿（同真實匯出一樣）都讀得返', () => {
  const img = makeLineArt();
  const before = new Uint8ClampedArray(img.data);
  const payload = codec.wmMakePayloadV2({ unit: 'ZTNG', date: '20261110', hash: 'C0DE' });
  codec.wmEmbed(img, payload);
  const d = codec.wmDecode(img);
  assert.equal(d.found, true, `白底線稿應該讀到（confidence=${d.confidence}）`);
  assert.equal(d.payload, payload);

  // 肉眼不可見：單點 ≤ 24 灰階、PSNR ≥ 35dB（線稿係最貼近真實匯出嘅 case）
  let maxDiff = 0, se = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = img.data[i + c] - before[i + c];
    maxDiff = Math.max(maxDiff, Math.abs(d));
    se += d * d; n++;
  }
  const psnr = 10 * Math.log10((255 * 255) / (se / n));
  assert.ok(maxDiff <= 24, `水印改動 ${maxDiff} 灰階，超出不可見範圍`);
  assert.ok(psnr >= 35, `PSNR ${psnr.toFixed(1)}dB 應 ≥ 35dB`);
});

test('未加水印嘅圖唔會誤判', () => {
  const d = codec.wmDecode(makeImage(320, 240, 3));
  assert.equal(d.found, false);
});

test('輕微噪訊／重新壓縮級干擾仍然讀得到（W4 限制內）', () => {
  const img = makeImage(512, 512, 11);
  codec.wmEmbed(img, codec.wmMakePayloadV2({ unit: 'ZTNG', date: '20261110', hash: '0F0F' }));
  let s = 99;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 12;
    for (let c = 0; c < 3; c++) img.data[i + c] = Math.max(0, Math.min(255, img.data[i + c] + n));
  }
  const d = codec.wmDecode(img);
  assert.equal(d.found, true, `加噪後仍應讀到（confidence=${d.confidence}）`);
});

test('水印改動幅度細（肉眼不可見：PSNR ≥ 32dB、單點 ≤ 24 灰階）', () => {
  const before = makeImage(256, 256, 5);
  const after = clone(before);
  codec.wmEmbed(after, codec.wmMakePayloadV2());
  let se = 0, n = 0, maxDiff = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = after.data[i + c] - before.data[i + c];
      se += d * d; n++;
      maxDiff = Math.max(maxDiff, Math.abs(d));
    }
  }
  const psnr = 10 * Math.log10((255 * 255) / (se / n));
  assert.ok(psnr >= 32, `PSNR ${psnr.toFixed(1)}dB 應 ≥ 32dB`);
  assert.ok(maxDiff <= 24, `單點最大改動 ${maxDiff} 灰階，應 ≤ 24`);
});

test('非 ASCII payload 要即刻拋錯（防止亂碼水印）', () => {
  assert.throws(() => codec.wmEmbed(makeImage(128, 128), '© SCOUT SYSTEM'), /PAYLOAD_MUST_BE_ASCII/);
});
