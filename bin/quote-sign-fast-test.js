// quote-sign.html 快速預覽測試（假閘道＋假主系統；Playwright 用系統已裝的 Chrome）。不連 GAS、不連閘道。
// 用法：node bin/quote-sign-fast-test.js [quote-sign.html 路徑] [截圖資料夾]
//   環境變數 PW_CORE＝playwright-core 位置（預設 /tmp/inbox-redraw-test/node_modules/playwright-core）
//   BASELINE＝舊版 quote-sign.html 路徑（有給就多拍一張舊版正本畫面做比對）
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, 'quote-sign.html');
const SHOTS = process.argv[3] || '';
const SRC = fs.readFileSync(FILE, 'utf8');
const PAD = fs.readFileSync(path.join(ROOT, 'pad.js'), 'utf8');
const RENDER = fs.readFileSync(path.join(ROOT, 'quote', 'quote-doc-render.js'), 'utf8');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://waynelin-yuzhi.github.io/yuzhi-liff/';
const GW = 'https://ytlakkxrbookftluulbo.supabase.co/functions/v1/api';
const GAS_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/;
const H = '0a1b2c3d4e5f60718293a4b5';   // 假值
const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '\n  got=' + JSON.stringify(a) + '\n  want=' + JSON.stringify(b)); }

// node 端用同一支排版器產正本的 docHtml（主系統也是同一支）
const R = {}; vm.createContext(R); vm.runInContext(RENDER + ';this._quoteDocHtml_=_quoteDocHtml_;', R);
const STAMP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const DOC = (o) => Object.assign({
  mode: 'purchase', date: '2026/11/20', validityDays: 14, quoteNo: 'Q-2026-TEST', isTaxEnabled: true, subtitle: '辦公室植栽',
  customer: { name: '測試設計股份有限公司', vat: '12345678', contact: '王小姐', phone: '02-0000-0000', address: '台北市測試路 1 號' },
  items: [1, 2, 3, 4, 5].map((i) => ({ name: '測試植栽 ' + i, spec: '6 吋盆・高約 60cm', unit: '盆', qty: i, price: 1200, total: 1200 * i, area: i < 3 ? '接待區' : '會議室' })),
  fees: [{ name: '運費與安裝', qty: 1, amount: 1500 }],
}, o || {});
const docHtmlOf = (doc, validUntil) => { R.QUOTE_DEFAULT_STAMP_URI = STAMP; return R._quoteDocHtml_(doc, validUntil ? { validUntil, validUntilExtended: false } : {}); };
// 閘道回應（形狀同 quoteSignView）
const GWR = (o) => Object.assign({ ok: true, title: '辦公室植栽', quoteNo: 'Q-2026-TEST', pdfId: 'P1', doc: DOC(), validUntilOverride: '', signed: null, stampDefault: STAMP,
  customer: '測試設計股份有限公司', clientShort: '測試設計', typeName: '單次採購', subtitle: '辦公室植栽', backend: 'local' }, o || {});
// 主系統正本（形狀同 quoteSignInfoByHash_）；docHtml 預設跟閘道那份畫出來的一模一樣
const OFF = (o) => Object.assign({ status: 'success', docHtml: docHtmlOf(DOC()), customer: '測試設計股份有限公司', clientShort: '測試設計', subtitle: '辦公室植栽',
  typeName: '單次採購', total: 19950, date: '2026/11/20', shareUrl: '', pdfId: 'P1', pdfUrl: 'https://drive.google.com/uc?export=download&id=P1',
  pdfViewUrl: BASE + 'doc-view.html?id=P1', quoteNo: 'Q-2026-TEST', sub: null, alreadySigned: false, signedAt: '', signer: '', signedPdfUrl: '' }, o || {});

// o.gw：物件／'abort'／'404'；o.gwDelay；o.off：物件／'abort'；o.offDelay；o.src 換頁面原始碼
async function open(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: o.ua });
  const st = { gw: [], off: [], docs: 0, errors: [] };
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = req.url(), p = u.split('?')[0];
    if (p === BASE + 'quote-sign.html') { st.docs++; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: o.src || SRC }); }
    if (p === BASE + 'pad.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: PAD });
    if (p === BASE + 'quote/quote-doc-render.js') return o.noRenderer ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'application/javascript', body: RENDER });
    const cors = { 'access-control-allow-origin': '*' };
    if (p === GW) {
      st.gw.push({ url: u, method: req.method(), body: req.postData(), hdrs: req.headers() });
      if (req.method() === 'OPTIONS') { st.preflight = true; return route.fulfill({ status: 204, headers: cors, body: '' }); }
      if (o.gwDelay) await new Promise((r) => setTimeout(r, o.gwDelay));
      if (o.gw === 'abort') return route.abort('failed').catch(() => {});
      if (o.gw === '404') return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: false, error: 'not_found' }) }).catch(() => {});
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(o.gw || GWR()) }).catch(() => {});
    }
    if (GAS_RE.test(u)) {
      st.off.push(u);
      const n = st.off.length;
      const delay = typeof o.offDelay === 'function' ? o.offDelay(n) : (o.offDelay == null ? 2500 : o.offDelay);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const v = typeof o.off === 'function' ? o.off(n) : o.off;
      if (v === 'abort') return route.abort('failed').catch(() => {});
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v || OFF()) }).catch(() => {});
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => st.errors.push(e.message));
  pg.on('dialog', (d) => d.dismiss());
  await pg.goto(BASE + 'quote-sign.html?v=9&h=' + H + '&openExternalBrowser=1' + (o.qs || ''));
  return { ctx, pg, st };
}
const txt = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const has = (pg, sel) => pg.evaluate((s) => !!document.querySelector(s), sel);
const box = (pg) => pg.evaluate(() => { const w = document.getElementById('docwrap'); if (!w) return null; const r = w.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; });
const frState = (pg) => pg.evaluate(() => { const f = document.getElementById('docfr'); return f ? { srcdoc: f.srcdoc, loads: window.__frLoads || 0 } : null; });
const countLoads = (pg) => pg.evaluate(() => { const f = document.getElementById('docfr'); window.__frLoads = 0; f.addEventListener('load', () => { window.__frLoads++; }); });
const shot = async (pg, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name), fullPage: true }); };
const wait = (pg, ms) => pg.waitForTimeout(ms);

(async () => {
  const { chromium } = require(process.env.PW_CORE || '/tmp/inbox-redraw-test/node_modules/playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    // 0. 靜態：閘道網址常數、載入文字、新對客文字原文、不靠版號
    ok(SRC.indexOf("var GW = 'https://ytlakkxrbookftluulbo.supabase.co/functions/v1/api';") >= 0, '閘道網址寫成常數');
    ok(SRC.indexOf('正在開啟報價單，大約需要幾秒鐘') >= 0 && SRC.indexOf('載入中…') < 0, '載入文字換成安心句');
    ok(SRC.indexOf('簽名區準備中，請先看報價單內容') >= 0 && SRC.indexOf('簽名區載入失敗，請重新整理再試一次') >= 0, '佔位與失敗文字');
    ok(!/PGV\s*(===?|!==?|<|>)/.test(SRC) && SRC.indexOf("action: 'quoteSignView', s: HASH") >= 0, '不依版號切換；快的一路走 POST quoteSignView 帶 s');
    ok(!/headers\s*:/.test(SRC.slice(SRC.indexOf('function fastLoad'), SRC.indexOf('function drawFast'))), '閘道請求不帶自訂 header');
    ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(SRC), '沒有 emoji');

    // 1. 閘道先到：立刻畫出報價單、簽名區是佔位不可送；正本後到：簽名區出現、文件不重畫、版面不跳
    {
      const r = await open(browser, { gwDelay: 200, offDelay: 3000 });
      await wait(r.pg, 150);
      eq(await txt(r.pg, '.done-card h2'), '正在開啟報價單，大約需要幾秒鐘', '兩邊都還沒回來時顯示安心句');
      await wait(r.pg, 1000);
      ok(await has(r.pg, '#docfr'), '閘道先到：報價單 iframe 已出現');
      const f1 = await frState(r.pg);
      ok(f1 && f1.srcdoc === docHtmlOf(DOC()), '閘道那份用同一支排版器畫、與正本字串相同');
      eq(await txt(r.pg, '#qsh1'), '報價單簽回', '標題');
      eq(await txt(r.pg, '#qssub'), '測試設計', '頁首副標用客戶簡稱');
      eq(await txt(r.pg, '#signslot'), '簽名區準備中，請先看報價單內容', '簽名區佔位文字');
      ok(!(await has(r.pg, '#go')) && !(await has(r.pg, '#signer')) && !(await has(r.pg, '#stampgo')) && !(await has(r.pg, '#cv')), '佔位期間沒有任何送出鈕、簽名板、用印上傳');
      ok(await r.pg.evaluate(() => getComputedStyle(document.getElementById('pdfdl')).pointerEvents === 'none' && !document.getElementById('pdfdl').getAttribute('href')), 'PDF 鈕在正本前不可點');
      ok(await has(r.pg, '#bkcopy'), '匯款區先出現');
      eq(await txt(r.pg, '#pgver'), 'quote-sign v9', '頁腳版字帶網址 v=9');
      const dims = await r.pg.evaluate(() => { const f = document.getElementById('docfr'); return { w: f.style.width, t: f.style.transform, h: parseInt(f.style.height, 10) }; });
      ok(dims.w === '794px' && /^scale\(/.test(dims.t) && dims.h > 1000, '同樣 794 寬、縮放、量高上鎖');
      const b1 = await box(r.pg);
      await shot(r.pg, '1-gateway-first.png');
      await countLoads(r.pg);
      await wait(r.pg, 2800);
      ok(await has(r.pg, '#go') && await has(r.pg, '#tabA') && await has(r.pg, '#stampgo'), '正本到：簽名區與用印回傳區出現');
      ok(!(await has(r.pg, '#signslot')), '佔位移除');
      const f2 = await frState(r.pg);
      eq(f2.loads, 0, '字串相同不重畫 iframe');
      const b2 = await box(r.pg);
      eq(b2, b1, '報價單區塊位置與高度不變');
      ok(await r.pg.evaluate(() => document.getElementById('pdfdl').getAttribute('href') === 'https://drive.google.com/uc?export=download&id=P1' && getComputedStyle(document.getElementById('pdfdl')).pointerEvents !== 'none'), 'PDF 鈕接上正本連結');
      // 正本對正後可以簽：簽名流程照舊
      await r.pg.fill('#signer', '王小姐');
      ok(await r.pg.evaluate(() => typeof PAD === 'object' && PAD && typeof PAD.hasInk === 'function'), '簽名板已初始化');
      await shot(r.pg, '2-official-arrived.png');
      eq(r.st.errors, [], '沒有頁面錯誤（情境 1）');
      eq(r.st.off.length, 1, '正本只讀一次');
      await r.ctx.close();
    }

    // 2. 正本內容跟閘道不同（效期不同）：換成正本、位置不變、高度最多在載入後重量一次
    {
      const offHtml = docHtmlOf(DOC(), '2026/12/31');
      const r = await open(browser, { gwDelay: 100, offDelay: 2000, off: OFF({ docHtml: offHtml, clientShort: '測試設計二' }) });
      await wait(r.pg, 1200);
      const b1 = await box(r.pg);
      await wait(r.pg, 1800);
      ok((await frState(r.pg)).srcdoc === offHtml, '內容不同時換成正本版本');
      ok(await r.pg.evaluate((h) => window.__docHtml === h, offHtml), '放大檢視也換成正本');
      const b2 = await box(r.pg);
      eq(b2.top, b1.top, '換正本時報價單位置不變');
      ok(Math.abs(b2.h - b1.h) <= 40, '高度只微調一次（' + b1.h + ' → ' + b2.h + '）');
      eq(await txt(r.pg, '#qssub'), '測試設計二', '頁首副標換成正本');
      eq(await r.pg.evaluate(() => getComputedStyle(document.getElementById('qssub')).height), '20px', '副標高度固定');
      ok(await has(r.pg, '#go'), '簽名區出現');
      await r.ctx.close();
    }

    // 3. 正本回已簽回／過期／無效：整頁改顯示對應畫面
    for (const [name, off, title] of [
      ['已簽回', OFF({ alreadySigned: true, signer: '王小姐', signedAt: '2026/11/21', signedPdfUrl: BASE + 'doc-view.html?id=S1', docHtml: null }), '已完成簽回'],
      ['過期', { status: 'error', msg: '此報價單已於 12/4 逾有效期限、暫停線上簽回。' }, '連結無效'],
      ['作廢', { status: 'error', msg: '此報價單已由植間作廢、連結不再有效。' }, '連結無效'],
    ]) {
      const r = await open(browser, { gwDelay: 100, offDelay: 1500, off });
      await wait(r.pg, 900);
      ok(await has(r.pg, '#docfr'), name + '：正本前先看到報價單');
      await wait(r.pg, 1200);
      eq(await txt(r.pg, '.done-card h2'), title, name + '：整頁改顯示對應畫面');
      ok(!(await has(r.pg, '#docfr')) && !(await has(r.pg, '#go')), name + '：報價單與簽名區都移除');
      if (off.msg) eq(await txt(r.pg, '.done-card p'), off.msg, name + '：顯示主系統訊息');
      await r.ctx.close();
    }

    // 4. 閘道失敗、逾時、查無、expired、legacy、signed、沒有 doc、排版器載不到：什麼都不做、等正本
    for (const [name, o] of [
      ['斷線', { gw: 'abort' }], ['查無 404', { gw: '404' }], ['expired', { gw: { ok: true, expired: true, message: 'x' } }], ['legacy', { gw: { ok: true, legacy: true } }],
      ['已簽回', { gw: GWR({ signed: { at: 'x', signer: 'y', sigUri: '', signedPdfId: 'S' } }) }], ['沒有 doc', { gw: GWR({ doc: null }) }], ['排版器載不到', { noRenderer: true }],
    ]) {
      const r = await open(browser, Object.assign({ gwDelay: 50, offDelay: 1500 }, o));
      await wait(r.pg, 900);
      eq(await txt(r.pg, '.done-card h2'), '正在開啟報價單，大約需要幾秒鐘', '閘道' + name + '：維持載入畫面');
      await wait(r.pg, 1100);
      ok(await has(r.pg, '#docfr') && await has(r.pg, '#go') && !(await has(r.pg, '#signslot')), '閘道' + name + '：正本照舊畫出');
      eq(r.st.errors, [], '閘道' + name + '：沒有頁面錯誤');
      await r.ctx.close();
    }
    {
      const r = await open(browser, { gwDelay: 7000, offDelay: 9000 });
      await wait(r.pg, 7600);
      eq(await txt(r.pg, '.done-card h2'), '正在開啟報價單，大約需要幾秒鐘', '閘道超過 6 秒：不畫');
      await wait(r.pg, 1800);
      ok(await has(r.pg, '#go'), '閘道逾時：正本照舊畫出');
      await r.ctx.close();
    }

    // 5. 正本先到：忽略之後才到的閘道
    {
      const r = await open(browser, { gwDelay: 1500, offDelay: 200 });
      await wait(r.pg, 800);
      ok(await has(r.pg, '#go'), '正本先到：照現在的行為畫出');
      await countLoads(r.pg);
      const b1 = await box(r.pg);
      await wait(r.pg, 1200);
      ok(r.st.gw.length === 1, '閘道仍有發出');
      ok(await has(r.pg, '#go') && !(await has(r.pg, '#signslot')), '晚到的閘道不改畫面');
      eq((await frState(r.pg)).loads, 0, '晚到的閘道不重畫文件');
      eq(await box(r.pg), b1, '版面不動');
      eq(await r.pg.evaluate(() => FAST), null, '快速預覽沒有啟動');
      await r.ctx.close();
    }

    // 6. 正本失敗但閘道那份已畫出：保留報價單、簽名區顯示重新整理；按了重新整理會重讀
    {
      const r = await open(browser, { gwDelay: 100, offDelay: (n) => n === 1 ? 1200 : 300, off: (n) => n === 1 ? 'abort' : OFF() });
      await wait(r.pg, 2000);
      ok(await has(r.pg, '#docfr'), '正本失敗：報價單保留');
      eq(await txt(r.pg, '#signslot .signph div'), '簽名區載入失敗，請重新整理再試一次', '正本失敗：失敗文字');
      ok(!(await has(r.pg, '#go')) && !(await has(r.pg, '#cv')) && !(await has(r.pg, '#stampgo')), '正本失敗：不可簽');
      eq(await txt(r.pg, '#reloadbtn'), '重新整理', '重新整理按鈕');
      await shot(r.pg, '3-official-failed.png');
      await Promise.all([r.pg.waitForNavigation(), r.pg.click('#reloadbtn')]);
      await wait(r.pg, 1200);
      ok(r.st.docs === 2 && r.st.off.length === 2, '按重新整理重開頁面並重讀正本');
      ok(await has(r.pg, '#go'), '重新整理後正本成功就可簽');
      await r.ctx.close();
    }
    {
      const r = await open(browser, { gw: 'abort', offDelay: 300, off: 'abort' });
      await wait(r.pg, 900);
      eq(await txt(r.pg, '.done-card h2'), '載入失敗', '兩邊都失敗：照舊整頁載入失敗');
      await r.ctx.close();
    }

    // 7. 請款單：佔位期間沒有簽收入口，正本到後出現「點此簽名」
    {
      const sdoc = DOC({ docKind: 'statement', payDueDays: 7 });
      const r = await open(browser, { gwDelay: 100, offDelay: 1500, gw: GWR({ doc: sdoc, typeName: '請款單', subtitle: '11 月養護' }), off: OFF({ docHtml: docHtmlOf(sdoc), typeName: '請款單', subtitle: '11 月養護' }) });
      await wait(r.pg, 900);
      eq(await txt(r.pg, '#qsh1'), '請款單', '請款單標題');
      ok(!(await has(r.pg, '#showsign')) && !(await has(r.pg, '#go')), '請款單佔位期間沒有簽收入口');
      await countLoads(r.pg);
      await wait(r.pg, 1200);
      ok(await has(r.pg, '#showsign') && await r.pg.evaluate(() => document.getElementById('confirmwrap').style.display === 'none'), '請款單正本到：簽收入口出現、簽名區照舊收起');
      eq((await frState(r.pg)).loads, 0, '請款單字串相同不重畫');
      await r.ctx.close();
    }

    // 8. LINE 內建瀏覽器：照舊自動再導一次；導走前不打閘道；警示卡照舊出現
    {
      const r = await open(browser, { ua: LINE_UA, gwDelay: 100, offDelay: 1200 });
      await wait(r.pg, 2200);
      eq(r.st.docs, 2, 'LINE：自動再導一次（頁面載入兩次）');
      ok(await r.pg.evaluate(() => sessionStorage.getItem('yzQsExt') === '1'), 'LINE：sessionStorage 記號照舊');
      eq(r.st.gw.length, 1, 'LINE：導走前那次不打閘道，導回後才打');
      ok(r.st.off.length >= 1, 'LINE：正本照舊讀取');
      ok(await r.pg.evaluate(() => /以預設瀏覽器開啟/.test(document.getElementById('app').textContent)), 'LINE：警示卡照舊');
      ok(await has(r.pg, '#go'), 'LINE：正本到後可簽');
      await r.ctx.close();
    }

    // 9. 閘道請求格式：POST、body 帶 action 與 s、text/plain、無預檢、網址不帶 hash
    {
      const r = await open(browser, { gwDelay: 50, offDelay: 600 });
      await wait(r.pg, 900);
      const g = r.st.gw.find((x) => x.method === 'POST');
      ok(!!g, '閘道用 POST');
      eq(JSON.parse(g.body), { action: 'quoteSignView', s: H }, 'body 只帶 action 與 s');
      ok(/^text\/plain/.test(g.hdrs['content-type'] || ''), 'Content-Type 是 text/plain');
      ok(!r.st.preflight, '沒有預檢');
      ok(g.url === GW && g.url.indexOf(H) < 0, '網址不帶簽署 hash');
      await r.ctx.close();
    }

    // 10. 閘道字串的隔離：客戶名含標籤時只當文字
    {
      const evil = '<img src=x onerror="window.__pwn=1">測試';
      const r = await open(browser, { gwDelay: 50, offDelay: 3000, gw: GWR({ clientShort: evil, doc: DOC({ customer: { name: evil } }) }) });
      await wait(r.pg, 1200);
      eq(await txt(r.pg, '#qssub'), evil, '副標用 textContent');
      ok(await r.pg.evaluate(() => !window.__pwn && !document.querySelector('#app img[src="x"]')), '外層沒有注入');
      ok(await r.pg.evaluate(() => { const d = document.getElementById('docfr').contentDocument; return !d.querySelector('img[src="x"]') && !window.__pwn; }), '報價單內客戶名被跳脫');
      await r.ctx.close();
    }

    // 舊版正本畫面（比對版面用）
    if (process.env.BASELINE && SHOTS) {
      const r = await open(browser, { src: fs.readFileSync(process.env.BASELINE, 'utf8'), gw: 'abort', offDelay: 200 });
      await wait(r.pg, 1500);
      await shot(r.pg, '0-baseline-old-official.png');
      await r.ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log((fail ? 'FAILED' : 'OK') + '  pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
