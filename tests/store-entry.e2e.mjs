// 只模擬入口 Referer／standalone 訊號；用出貨嘅閘門同真正分頁，唔寫通行證。
// 由 tests/e2e.mjs 呼叫；最後留喺 APP STORE 獲准嘅頁面，繼續測繪圖、作品集同匯出。
export async function checkStoreEntry(page, base, check) {
  const url = `${base}/`;
  const browser = page.browser();
  const response = await page.goto(url);
  const direct = await page.evaluate(() => ({
    reason: storeEntry.reason,
    actions: [...document.querySelectorAll('button, a')].filter(el => el.getClientRects().length).map(el => [el.textContent.trim(), el.href]),
    appstore: ScoutStoreGate.getPortal('appstore').url,
    library: ScoutStoreGate.getPortal('library').url,
    hidden: !document.querySelector('main').getClientRects().length && !document.querySelector('#storeSupportTop').getClientRects().length,
  }));
  check('直打：HTTP 200、只見一粒 APP STORE 掣，主體及 SG18 隱藏', response.status() === 200 &&
    direct.reason === 'missing-whitelist-entry' && direct.hidden && direct.actions.length === 1 &&
    direct.actions[0][0] === '前往 APP STORE' && direct.actions[0][1] === direct.appstore);

  const enter = async (tab, id) => {
    // 本機 HTTP preview 收唔到預設 HTTPS → HTTP Referer；模擬兩個正式 HTTPS 站之間嘅 origin-only 導覽。
    await tab.goto(url, { referer: direct[id], referrerPolicy: 'origin' });
    const result = await tab.evaluate(() => ({
      decision: storeEntry, visible: !!document.querySelector('main').getClientRects().length,
      prompt: !!document.querySelector('#scoutStoreGate, #scoutSupportNudge'),
    }));
    check(`${id}：獲准進入、冇提示`, result.visible && !result.prompt && result.decision.allowed &&
      result.decision.reason === 'referrer-whitelist' && result.decision.matchedPortalId === id,
      `matchedPortalId: ${result.decision.matchedPortalId}`);
  };

  const libraryTab = await browser.newPage();
  await enter(libraryTab, 'library');
  await libraryTab.reload();
  check('同分頁重整保留通行證', await libraryTab.evaluate(() => storeEntry.reason === 'session-pass'));
  await libraryTab.close();

  const homeTab = await browser.newPage();
  await homeTab.evaluateOnNewDocument(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query } : native(query);
  });
  await homeTab.goto(url);
  check('模擬主畫面：無 Referer 仍獲准', await homeTab.evaluate(() => !document.referrer &&
    storeEntry.reason === 'standalone-pwa' && !!document.querySelector('main').getClientRects().length));
  await homeTab.close();

  const missingTab = await browser.newPage();
  await missingTab.setRequestInterception(true);
  missingTab.on('request', r => new URL(r.url()).pathname === '/store_gate_v1.0.js' ? r.abort() : r.continue());
  await missingTab.goto(url);
  check('閘門檔未載入：SG18 冇死連', await missingTab.$eval('#storeSupportTop', el => !window.ScoutStoreGate &&
    el.hidden && !el.hasAttribute('href') && getComputedStyle(el).display === 'none'));
  await missingTab.close();

  await enter(page, 'appstore');
  for (const width of [360, 430]) {
    await page.setViewport({ width, height: 844 });
    const fits = await page.$eval('header #storeSupportTop', el => {
      const r = el.getBoundingClientRect();
      return r.width >= 40 && r.height >= 40 && r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    });
    check(`${width}px：SG18 觸控 ≥ 40px、冇橫向溢出`, fits);
  }
  await page.focus('#galleryBtn');
  await page.keyboard.press('Tab');
  check('鍵盤 Tab 到 SG18 有可見焦點及新分頁說明', await page.$eval('#storeSupportTop', el =>
    el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none' && el.getAttribute('aria-label')?.includes('開新分頁')));
  await page.emulateMediaType('print');
  check('列印隱藏 SG18', await page.$eval('#storeSupportTop', el => getComputedStyle(el).display === 'none'));
  await page.emulateMediaType('screen');

  // 只驗瀏覽器真正開分頁嘅 URL／noopener；唔連主站，唔扮驗過線上詳情卡。
  const session = await page.createCDPSession();
  await session.send('Page.enable');
  let navigation;
  session.once('Page.windowOpen', e => { navigation = e; });
  const oldTargets = new Set(browser.targets());
  const [target] = await Promise.all([
    browser.waitForTarget(t => t.type() === 'page' && !oldTargets.has(t), { timeout: 5000 }),
    page.click('#storeSupportTop'),
  ]);
  const popup = await target.page();
  const expected = new URL(direct.appstore);
  expected.searchParams.set('app', 'zentangle-pattern-generator'); // 已按正式 host 核實嘅 seed slug
  check('SG18：開獨立新分頁，指向已核實嘅詳情卡 URL', navigation?.url === expected.href &&
    navigation.windowName === '_blank' && await popup.evaluate(() => window.opener === null), navigation?.url);
  await popup.close();
  await session.detach();
  await page.bringToFront();
}
