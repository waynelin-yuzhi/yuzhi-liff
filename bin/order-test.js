// order.html 本機測試（靜態檢查＋假後端行為測試；Playwright 用系統已裝的 Chrome）。不連 GAS。
// 用法：node bin/order-test.js [order.html 路徑]
//   環境變數 PW_CORE＝playwright-core 位置（預設 /tmp/inbox-redraw-test/node_modules/playwright-core）
const path = require('path'), fs = require('fs');
const FILE = process.argv[2] || path.join(__dirname, '..', 'order.html');
const SRC = fs.readFileSync(FILE, 'utf8');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOCAL_PAGE = 'http://127.0.0.1:8799/order.html';
const LIVE_PAGE = 'https://waynelin-yuzhi.github.io/yuzhi-liff/order.html';
const MOCK_API = 'http://127.0.0.1:8798/exec';
const GAS_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/;
const SIGN = 'https://waynelin-yuzhi.github.io/yuzhi-liff/quote-sign.html?h=abc';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '\n  got=' + JSON.stringify(a) + '\n  want=' + JSON.stringify(b)); }

// ── 靜態檢查 ──
const script = (SRC.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
ok(SRC.indexOf('innerHTML') < 0 && SRC.indexOf('outerHTML') < 0 && SRC.indexOf('insertAdjacentHTML') < 0 && SRC.indexOf('document.write') < 0, '不用 innerHTML／outerHTML／insertAdjacentHTML／document.write');
ok(!/<script[^>]*\bsrc\s*=/i.test(SRC), '沒有外部 script（含同站）');
ok(!/<link[^>]+href\s*=\s*["']?https?:/i.test(SRC) && !/@import/i.test(SRC), '沒有外部 CSS／字型');
ok(!/<iframe/i.test(SRC), '沒有 iframe');
ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(SRC), '沒有 emoji');
ok(!/[—―─]/.test(SRC), '沒有破折號');
ok(!/content-type/i.test(script) && !/headers\s*:/.test(script), 'POST 不設 Content-Type、不帶自訂 header');
ok(!/gtag|google-analytics|googletagmanager|fbq\(|clarity/i.test(SRC), '沒有追蹤碼');
ok(/<meta name="robots" content="noindex">/.test(SRC), 'noindex');
ok(SRC.indexOf('openExternalBrowser') < 0 && !/location\.replace/.test(script), '不把 LINE 內建瀏覽器轉去外部');
ok(/IS_LOCAL\s*=\s*location\.hostname === 'localhost' \|\| location\.hostname === '127\.0\.0\.1'/.test(script), 'api 覆寫的判斷式只認 localhost／127.0.0.1');
ok(/<span[^>]*id="pgver"[^>]*>order<\/span>/.test(SRC), '頁腳版字 pgver 預設 order');

const ITEMS = [
  { id: 'M-0868', name: '聖誕紅 5吋・12盆一組（含套袋）', spec: '5 吋', unit: '組', priceIncTax: 3600 },
  { id: 'M-0872', name: '聖誕紅 混搭・5吋6盆＋7吋6盆一組（含套袋）', spec: '混搭', unit: '組', priceIncTax: 5100 },
  { id: 'M-0869', name: '聖誕紅 7吋・12盆一組（含套袋）', spec: '7 吋', unit: '組', priceIncTax: 6600 }
];
const DATA = (o) => Object.assign({ ok: true, preview: false, title: '聖誕紅加購', note: '預購至 12/1', client: { name: '邦鉑科技股份有限公司' },
  heroImage: 'http://127.0.0.1:8798/hero.png', items: ITEMS, maxQtyEach: 20, existing: null }, o || {});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// get: 讀資料回應（物件或 'abort'）；post: 送出回應（物件、'abort'、'hang'）
async function open(browser, page, query, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const st = { gets: [], posts: [], dialogs: 0, errors: [] };
  let hang = null;
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = req.url();
    if (u.split('?')[0] === page) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SRC });
    if (u.indexOf('/hero.png') > 0) return o.heroFail ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.split('?')[0] === MOCK_API || GAS_RE.test(u)) {
      if (req.method() === 'GET') {
        st.gets.push(u);
        if (o.get === 'abort') return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o.get || DATA()) });
      }
      if (req.method() === 'POST') {
        st.posts.push({ url: u, body: req.postData(), ct: req.headers()['content-type'] || '' });
        const p = typeof o.post === 'function' ? o.post(st.posts.length) : o.post;
        if (p === 'abort') return route.abort('failed');
        if (p === 'hang') { hang = route; return; }
        if (o.postDelay) await new Promise((r) => setTimeout(r, o.postDelay));
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(p || { ok: true, quoteNo: 'Q-2026-131', total: 12300, lines: [{ id: 'M-0868', name: ITEMS[0].name, qty: 2 }, { id: 'M-0872', name: ITEMS[1].name, qty: 1 }], signUrl: SIGN }) });
      }
      if (req.method() === 'OPTIONS') { st.options = true; return route.fulfill({ status: 204, body: '' }); }
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const pg = await ctx.newPage();
  pg.on('dialog', (d) => { st.dialogs++; d.dismiss(); });
  pg.on('pageerror', (e) => st.errors.push(e.message));
  if (o.clock) await pg.clock.install();
  await pg.goto(page + query);
  await pg.waitForTimeout(o.wait || 300);
  return { ctx, pg, st, release: () => hang && hang.abort('failed').catch(() => {}) };
}
const Q = (t, extra) => '?t=' + encodeURIComponent(t) + '&v=3&api=' + encodeURIComponent(MOCK_API) + (extra || '');
const txt = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const vis = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.offsetParent !== null || (e && getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none')); }, sel);
const plus = (pg, i, n) => pg.evaluate(([i, n]) => { const b = document.querySelectorAll('.step .plus')[i]; for (let k = 0; k < n; k++) b.click(); }, [i, n]);

(async () => {
  const { chromium } = require(process.env.PW_CORE || '/tmp/inbox-redraw-test/node_modules/playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    // 1. 載入：抓資料一次、三個主標分得開、0 時送出鈕停用
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok1'));
      eq(r.st.gets.length, 1, '讀資料一次');
      ok(r.st.gets[0].indexOf(MOCK_API + '?page=set-order&t=tok1&fmt=json&_=') === 0, '讀資料網址格式');
      const heads = await r.pg.$$eval('.head', (a) => a.map((e) => e.textContent));
      eq(heads, ['5吋・12盆一組', '混搭・5吋6盆＋7吋6盆一組', '7吋・12盆一組'], '品名主標只留區分的部分');
      eq(await r.pg.$$eval('.kick', (a) => a.map((e) => e.textContent)), ['聖誕紅・含套袋', '聖誕紅・含套袋', '聖誕紅・含套袋'], '共同字頭與括號收成小字');
      eq(await txt(r.pg, 'h1'), '聖誕紅加購', '標題');
      eq(await r.pg.title(), '植間設計｜聖誕紅加購', '頁面標題');
      eq(await txt(r.pg, '.sub'), '訂購單位：邦鉑科技股份有限公司', '訂購單位');
      eq(await txt(r.pg, '#pgver'), 'order v3', '頁腳版字帶網址 v');
      eq(await txt(r.pg, '#go'), '請先選擇數量', '全 0 時按鈕文字');
      ok(await r.pg.$eval('#go', (b) => b.disabled), '全 0 時按鈕停用');
      const sizes = await r.pg.$$eval('.step button', (a) => a.map((b) => [b.offsetWidth, b.offsetHeight]));
      ok(sizes.every(([w, h]) => w >= 44 && h >= 44), '加減鈕觸控區至少 44px');
      ok(await r.pg.$$eval('select, input[type=number]', (a) => a.length === 0), '沒有下拉選單或 number input');
      ok(await r.pg.$eval('.hero img', (i) => i.className === 'on'), '主圖載入後顯示');
      const ar = await r.pg.$eval('.hero', (h) => h.offsetWidth / h.offsetHeight);
      ok(Math.abs(ar - 4 / 3) < 0.02, '主圖框 4:3');
      // 盆數圖示（D 款）：5 吋組一個、混搭兩個（大的在前）、7 吋組一個
      eq(JSON.stringify(await r.pg.$$eval('.item', (a) => a.map((e) => Array.from(e.querySelectorAll('.comp .c')).map((c) => c.querySelector('.n').textContent + '|' + c.querySelector('.z').textContent + '|' + c.querySelector('svg').getAttribute('width'))))), JSON.stringify([['× 12|5 吋|34'], ['× 6|7 吋|46', '× 6|5 吋|34'], ['× 12|7 吋|46']]), '盆數圖示：各組的盆數、尺寸與大小圖示');
      // 加減與上限
      await plus(r.pg, 0, 2); await plus(r.pg, 1, 1);
      eq(await txt(r.pg, '#cnt'), '共 3 組　含稅合計', '組數即時更新');
      eq(await txt(r.pg, '#tot'), 'NT$12,300', '合計千分位');
      ok(await r.pg.$$eval('.item', (a) => a.map((e) => e.classList.contains('sel'))).then((x) => JSON.stringify(x) === '[true,true,false]'), '已選列標示');
      await plus(r.pg, 2, 25);
      eq(await r.pg.$$eval('.q', (a) => a[2].textContent), '20', '數量上限 maxQtyEach');
      ok(await r.pg.$$eval('.plus', (a) => a[2].disabled), '到上限加號停用');
      await r.pg.evaluate(() => { const b = document.querySelectorAll('.minus')[2]; for (let k = 0; k < 25; k++) b.click(); });
      eq(await r.pg.$$eval('.q', (a) => a[2].textContent), '0', '減到 0 為止');
      // 確認層：按送出先開確認、不送
      await r.pg.click('#go');
      ok(await vis(r.pg, '#confirm'), '按送出先開確認層');
      eq(r.st.posts.length, 0, '開確認層時還沒送');
      const ctext = await txt(r.pg, '#confirm');
      ok(ctext.indexOf('送出後我們會傳報價單給您，線上簽名後才完成訂購。') >= 0, '確認層說明句');
      ok(ctext.indexOf('訂購單位：邦鉑科技股份有限公司') >= 0 && ctext.indexOf('NT$12,300') >= 0 && ctext.indexOf('× 2 組') >= 0, '確認層列出單位、各列、合計');
      ok(ctext.indexOf('取代') < 0, '沒有 existing 時不出取代句');
      await r.pg.click('#cback');
      ok(!(await vis(r.pg, '#confirm')), '返回修改關閉確認層');
      eq(r.st.posts.length, 0, '返回修改不送');
      eq(await txt(r.pg, '#tot'), 'NT$12,300', '返回後數量還在');
      await r.pg.fill('#who', '  王小明 ');
      // 確認送出：連按只送一次
      await r.pg.click('#go');
      await r.pg.evaluate(() => { const b = document.getElementById('cok'); b.click(); b.click(); b.click(); });
      eq(await txt(r.pg, '#cok'), '送出中…', '確認送出後立刻顯示送出中');
      ok(await r.pg.$eval('#cok', (b) => b.disabled) && await r.pg.$eval('#cback', (b) => b.disabled), '送出中兩顆按鈕鎖住');
      await r.pg.waitForTimeout(400);
      eq(r.st.posts.length, 1, '連按只送一次');
      const p = r.st.posts[0];
      eq(p.url, MOCK_API + '?publicOrder=set&respond=json', '送出網址');
      eq(JSON.parse(p.body), { t: 'tok1', lines: [{ id: 'M-0868', qty: 2 }, { id: 'M-0872', qty: 1 }], who: '王小明' }, '送出 body：只送 qty>0、姓名去空白');
      ok(/^text\/plain/.test(p.ct), '簡單請求 text/plain（不觸發預檢）');
      ok(!r.st.options, '沒有預檢 OPTIONS');
      // 成功畫面
      const done = await txt(r.pg, '#done');
      ok(done.indexOf('已收到您的訂購') >= 0 && done.indexOf('報價單號：Q-2026-131') >= 0 && done.indexOf('NT$12,300') >= 0, '成功畫面標題、單號、合計');
      ok(done.indexOf('報價單也會傳到 LINE 對話，簽名後才完成訂購。') >= 0, '成功畫面說明句');
      eq(await r.pg.$eval('#sign', (a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]), ['前往確認並簽署報價單', SIGN, null], '簽署鈕連 signUrl、同分頁');
      ok(!(await vis(r.pg, '#bar')), '成功畫面收起底部列');
      await r.pg.click('text=重新選擇');
      eq(await txt(r.pg, '#tot'), 'NT$12,300', '重新選擇保留數量');
      eq(await r.pg.inputValue('#who'), '  王小明 ', '重新選擇保留姓名');
      ok((await txt(r.pg, '#existing') || '').indexOf('Q-2026-131') >= 0, '回主畫面顯示剛送出的待簽提示');
      ok(r.st.errors.length === 0 && r.st.dialogs === 0, '沒有 JS 錯誤、沒有原生對話框');
      await r.ctx.close();
    }
    // 2. 送出失敗：網路斷、後端 ok:false、逾時；數量不遺失、不顯示成功
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok2'), { post: 'abort' });
      await plus(r.pg, 1, 2); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      eq(await txt(r.pg, '#cerr'), '還沒收到送出結果，請再按一次「確認送出」，同一份訂購不會重複成立。', '網路斷：確認層顯示重試句');
      ok(await vis(r.pg, '#confirm') && !(await r.pg.$('#done')), '網路斷：停在確認層、沒有成功畫面');
      ok(!(await r.pg.$eval('#cok', (b) => b.disabled)) && (await txt(r.pg, '#cok')) === '確認送出', '網路斷：按鈕解鎖可再送');
      await r.pg.click('#cback');
      eq(await txt(r.pg, '#tot'), 'NT$10,200', '網路斷：數量還在');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok3'), { post: (n) => n === 1 ? { ok: false, error: 'rate_limited', msg: '太頻繁了' } : undefined });
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      eq(await txt(r.pg, '#cerr'), '太頻繁了', 'ok:false：顯示後端 msg');
      await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      ok(!!(await r.pg.$('#done')) && r.st.posts.length === 2, 'ok:false 後再按一次可送成功');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok4'), { post: { ok: false, error: 'bad_lines' } });
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      eq(await txt(r.pg, '#cerr'), '系統忙碌中，請稍後再試一次。', 'ok:false 沒有 msg：預設句');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok5h'), { post: { ok: false, error: 'handoff', msg: '這次沒有自動完成，我們已收到您選的組合，確認後會再跟您聯繫。' } });
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      ok((await txt(r.pg, '.done-card p')) === '這次沒有自動完成，我們已收到您選的組合，確認後會再跟您聯繫。' && (await txt(r.pg, '.done-card h2')) === '我們會再跟您聯繫' && !(await r.pg.$('#confirm')), '送出後轉人工：顯示終局訊息、確認層關閉不可重按');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok5'), { post: { ok: false, error: 'expired' } });
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      ok((await txt(r.pg, '.done-card p')) === '這次預購已經截止，需要的話請直接在 LINE 跟我們說。' && !(await vis(r.pg, '#bar')) && !(await r.pg.$('#confirm')), '送出時已截止：改顯示截止訊息卡');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok6'), { post: 'hang', clock: true });
      await plus(r.pg, 0, 3); await r.pg.click('#go'); await r.pg.click('#cok');
      await r.pg.clock.runFor(59000);
      eq(await txt(r.pg, '#cok'), '送出中…', '59 秒時仍在送出中');
      await r.pg.clock.runFor(1500);
      eq(await txt(r.pg, '#cerr'), '還沒收到送出結果，請再按一次「確認送出」，同一份訂購不會重複成立。', '60 秒逾時：顯示重試句');
      ok(!(await r.pg.$('#done')), '逾時：沒有成功畫面');
      r.release();
      await r.pg.waitForTimeout(200);
      ok(!(await r.pg.$('#done')), '逾時後晚到的回應不會翻成成功');
      await r.pg.click('#cback');
      eq(await txt(r.pg, '#tot'), 'NT$10,800', '逾時：數量還在');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok7'), { post: { ok: true, quoteNo: 'Q-1', total: 3600, lines: [], signUrl: 'javascript:alert(1)' } });
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      ok(!!(await r.pg.$('#done')) && !(await r.pg.$('#sign')), 'signUrl 不是 http(s)：不出簽署鈕');
      await r.ctx.close();
    }
    // 3. existing：提示、預帶數量、確認層多一句
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok8'), { get: DATA({ existing: { quoteNo: 'Q-2026-130', total: 7200, lines: [{ id: 'M-0868', name: 'x', qty: 2 }, { id: 'NOPE', qty: 5 }, { id: 'M-0869', qty: 99 }], signUrl: SIGN } }) });
      eq(await txt(r.pg, '#existing div'), '您已送出過訂購（報價單 Q-2026-130，含稅 NT$7,200），還沒完成簽名', 'existing 提示句');
      eq(await r.pg.$eval('#existing a', (a) => [a.textContent, a.getAttribute('href')]), ['前往簽署', SIGN], 'existing 前往簽署鈕');
      eq(await r.pg.$$eval('.q', (a) => a.map((e) => e.textContent)), ['2', '0', '20'], 'existing 預帶數量（不明品項略過、超過上限截斷）');
      await r.pg.click('#go');
      ok((await txt(r.pg, '#confirm')).indexOf('重新送出會取代上一張還沒簽的報價單。') >= 0, 'existing 確認層多一句取代');
      await r.ctx.close();
    }
    // 4. 預覽
    {
      const r = await open(browser, LOCAL_PAGE, Q('tok9'), { get: DATA({ preview: true }), post: { ok: true, preview: true, msg: '這是預覽，沒有成立任何訂單。' } });
      eq(await txt(r.pg, '#pvbar'), '預覽模式，送出不會成立訂單', '預覽提示條');
      await plus(r.pg, 0, 1); await r.pg.click('#go'); await r.pg.click('#cok'); await r.pg.waitForTimeout(300);
      ok((await txt(r.pg, '#done')).indexOf('這是預覽，沒有成立任何訂單。') >= 0 && !(await r.pg.$('#sign')), '預覽送出：顯示 msg、沒有簽署鈕');
      ok(await vis(r.pg, '#pvbar'), '預覽送出後提示條還在');
      await r.ctx.close();
    }
    // 5. 載入錯誤
    const DEF = {
      invalid: '連結無效，請從 LINE 訊息重新開啟。',
      expired: '這次預購已經截止，需要的話請直接在 LINE 跟我們說。',
      closed: '目前暫停訂購，請直接在 LINE 跟我們說。',
      not_eligible: '這個連結目前無法訂購，請直接在 LINE 跟我們說，我們協助您。',
      busy: '系統忙碌中，請稍後再試一次。',
      weird: '系統忙碌中，請稍後再試一次。'
    };
    for (const k of Object.keys(DEF)) {
      const r = await open(browser, LOCAL_PAGE, Q('e' + k), { get: { ok: false, error: k } });
      eq(await txt(r.pg, '.done-card p'), DEF[k], '載入 ' + k + '：預設句');
      ok(!(await vis(r.pg, '#bar')) && !(await r.pg.$('.item')), '載入 ' + k + '：沒有品項與送出列');
      await r.ctx.close();
    }
    {
      const r = await open(browser, LOCAL_PAGE, Q('em'), { get: { ok: false, error: 'expired', msg: '後端的話' } });
      eq(await txt(r.pg, '.done-card p'), '後端的話', '載入錯誤：有 msg 用 msg');
      await r.ctx.close();
      const r2 = await open(browser, LOCAL_PAGE, Q('ab'), { get: 'abort' });
      eq(await txt(r2.pg, '.done-card p'), DEF.busy, '載入網路錯誤：忙碌句');
      ok(!!(await r2.pg.$('.done-card button')), '載入網路錯誤：有重新載入鈕');
      await r2.ctx.close();
      const r3 = await open(browser, LOCAL_PAGE, '?v=1&api=' + encodeURIComponent(MOCK_API));
      eq(await txt(r3.pg, '.done-card p'), DEF.invalid, '沒帶 t：連結無效');
      eq(r3.st.gets.length, 0, '沒帶 t：不打後端');
      await r3.ctx.close();
      const r4 = await open(browser, LOCAL_PAGE, Q('tok'), { get: DATA({ items: [] }) });
      ok(!(await r4.pg.$('.item')) && (await txt(r4.pg, '.done-card p')).length > 0, '品項為空：訊息卡');
      await r4.ctx.close();
    }
    // 6. 防注入、破圖
    {
      const r = await open(browser, LOCAL_PAGE, Q('x'), { get: DATA({ title: '<img src=x onerror="window.__pwn=1">', note: '<b>n</b>', client: { name: '<script>window.__pwn=2</script>' },
        items: [{ id: 'A', name: '<img src=y onerror="window.__pwn=3"> 甲', spec: '<i>s</i>', unit: '<u>組</u>', priceIncTax: 1 }] }), heroFail: true });
      await r.pg.waitForTimeout(200);
      ok(!(await r.pg.evaluate(() => window.__pwn)) && (await r.pg.$$eval('#app img, #app b, #app i, #app u, #app script', (a) => a.filter((e) => !e.closest('.hero')).length)) === 0, '後端字串一律當文字');
      eq(await txt(r.pg, 'h1'), '<img src=x onerror="window.__pwn=1">', '標題原樣顯示為文字');
      ok(await r.pg.$eval('.hero', (h) => h.style.display === 'none'), '主圖載入失敗：整塊隱藏');
      await r.ctx.close();
      const r2 = await open(browser, LOCAL_PAGE, Q('x'), { get: DATA({ heroImage: 'javascript:alert(1)' }) });
      ok(!(await r2.pg.$('.hero')), '主圖網址不是 http(s)：不顯示');
      await r2.ctx.close();
    }
    // 7. api 參數：本機才生效、只准本機位址；線上一律打正式後端
    {
      const r = await open(browser, LIVE_PAGE, Q('live'));
      ok(r.st.gets.length === 1 && GAS_RE.test(r.st.gets[0]), '線上網域忽略 api 參數、打正式後端');
      await r.ctx.close();
      const r2 = await open(browser, LOCAL_PAGE, '?t=a&api=' + encodeURIComponent('https://evil.example/exec'));
      ok(r2.st.gets.length === 1 && GAS_RE.test(r2.st.gets[0]), '本機但 api 指向外部網域：忽略');
      await r2.ctx.close();
      const r3 = await open(browser, LOCAL_PAGE, '?t=a');
      ok(r3.st.gets.length === 1 && GAS_RE.test(r3.st.gets[0]), '本機沒帶 api：打正式後端');
      await r3.ctx.close();
    }
  } finally { await browser.close(); }
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
