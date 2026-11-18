import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url));

test('V1：lockfile 兩個根版號同 package 一致', () => {
  const { version } = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
});

test('閘門係真理倉原檔；charset 之後、title 之前同步初始化', () => {
  // playerkousas-rgb/readme@4c63ac3 · templates/vercel/store_gate_v1.0.js
  const sha = createHash('sha256').update(read('public/store_gate_v1.0.js')).digest('hex');
  assert.equal(sha, '45de189d68e9fbf64d560a4306987d1a03cd03f03e56dd24222a4343011e3d5b');

  const beforeTitle = read('index.html').toString().split('<title>')[0];
  const init = beforeTitle.match(/<meta charset="UTF-8">[\s\S]*?<script src="\/store_gate_v1\.0\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);
  assert.ok(init, '入口要同步載入 public/ 嘅原版 script');
  const calls = [];
  new Function('initStoreGate', init[1])(options => calls.push(options));
  assert.deepEqual(calls, [{
    appKey: 'zentangle-pattern-generator', mode: 'entry-gate', portalIds: ['appstore'],
    silentPortalIds: ['library'], allowStandalone: true, autoRedirectSeconds: 0,
  }]);
});
