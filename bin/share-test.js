// share.html 本機測試（假 liff 物件＋假後端；Playwright 用系統已裝的 Chrome）。不連 LINE、不連 GAS。
// 用法：node bin/share-test.js [share.html 路徑]
//   環境變數 PW_CORE＝playwright-core 位置（預設 /tmp/inbox-redraw-test/node_modules/playwright-core）
//   GAS_REPO＝主系統 repo（比對養護群組邀請卡與主系統 builder 一致；預設 /tmp/wt-gas-caregroup，沒有就用 ~/yuzhiplant-system）
const path = require('path'), fs = require('fs'), vm = require('vm'), os = require('os');
const { chromium } = require(process.env.PW_CORE || '/tmp/inbox-redraw-test/node_modules/playwright-core');
const FILE = process.argv[2] || path.join(__dirname, '..', 'share.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'https://waynelin-yuzhi.github.io';
const PAGE = ORIGIN + '/yuzhi-liff/share.html';
const API_RE = /script\.google\.com\/macros\/s\//;
const LIFF_ID = '2010719321-KOziooMo';
const CG_API = 'https://ytlakkxrbookftluulbo.supabase.co/functions/v1/api';
const TOK = 'GoodTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // 43 字 base64url
const TOKENS = {   // 假的 shareCardGet
  [TOK]: { ok: true, kind: 'caregroup', payload: { inviteCode: 'AbCdEf123_', clientShort: '科力雲', groupName: '科力雲 x 有植 - 養護' } },
  ExpiredTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: false, error: 'expired' },
  RevokedTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: false, error: 'revoked' },
  EvilPayloadTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: true, kind: 'caregroup', payload: { inviteCode: 'https://evil.test/x', clientShort: '科力雲' } },
  WrongKindTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: true, kind: 'plant', payload: { inviteCode: 'AbCdEf123_', clientShort: '科力雲' } },
  XssNameTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: true, kind: 'caregroup', payload: { inviteCode: 'AbCdEf123_', clientShort: '<img src=x onerror=alert(1)>' } },
  ServerErrTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: { ok: false, error: 'internal' }
};

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '\n  got=' + JSON.stringify(a) + '\n  want=' + JSON.stringify(b)); }

// 主系統的邀請卡（_cgsInviteLinkCard_ 經 _approvalLinkCardBubble_ 畫）
function gasBubble(code, short, token) {
  const cand = [process.env.GAS_REPO, '/tmp/wt-gas-caregroup', path.join(os.homedir(), 'yuzhiplant-system')].filter(Boolean);
  const repo = cand.find((d) => { try { return fs.readFileSync(path.join(d, 'public-care-group-setup.gs'), 'utf8').indexOf('_cgsInviteLinkCard_') >= 0; } catch (e) { return false; } });
  if (!repo) throw new Error('找不到含 _cgsInviteLinkCard_ 的主系統 repo（設 GAS_REPO）');
  const r = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const grab = (s, n) => { const i = s.indexOf('function ' + n + '('); let d = 0; const j = s.indexOf('{', i); for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (!d) return s.slice(i, k + 1); } } throw new Error(n); };
  const C = r('public-care-group-setup.gs'), A = r('public-approval-center.gs');
  const c = {}; vm.createContext(c);
  vm.runInContext(r('flex-kit.gs') + '\n' + grab(A, '_approvalLinkCardBubble_') + '\n' + grab(A, '_approvalLinkCardAlt_') + '\n'
    + ['CGS_SHARE_LIFF_ID', 'CGS_SHARE_CARD', 'CGS_SHARE_NAME_RE'].map((k) => C.match(new RegExp('var ' + k + ' = [^\\n]*'))[0]).join('\n') + '\n'
    + grab(C, '_cgsShareName_') + grab(C, '_cgsShareUrl_') + grab(C, '_cgsInviteLinkCard_'), c);
  const lk = c._cgsInviteLinkCard_(code, short, token);
  return { bubble: JSON.parse(JSON.stringify(c._approvalLinkCardBubble_(lk))), alt: c._approvalLinkCardAlt_(lk) };
}

const LIFF_STUB = (o) => `window.__t = { shares: [], logins: 0, closed: 0, opens: [] };
window.liff = {
  init: function () { return ${o.initFail ? 'Promise.reject(new Error("x"))' : 'Promise.resolve()'}; },
  isApiAvailable: function (n) { return n === 'shareTargetPicker' ? ${o.picker !== false} : false; },
  isInClient: function () { return ${o.inClient !== false}; },
  isLoggedIn: function () { return false; },
  login: function () { window.__t.logins++; },
  closeWindow: function () { window.__t.closed++; },
  shareTargetPicker: function (m) { window.__t.shares.push(m); return ${o.pickerFail ? 'Promise.reject(new Error("x"))' : 'Promise.resolve({ status: "success" })'}; },
  getAccessToken: function () { return ''; }, getIDToken: function () { return ''; }, getContext: function () { return {}; }, openWindow: function () {}
};`;

async function open(browser, query, o) {
  o = o || {};
  const ctx = await browser.newContext();
  const st = { api: [], cg: [] };
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.split('?')[0] === PAGE) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(FILE, 'utf8') });
    if (/static\.line-scdn\.net\/liff/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LIFF_STUB(o) });
    if (u.split('?')[0] === CG_API) {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      st.cg.push({ b, ct: route.request().headers()['content-type'] || '' });
      if (o.cgAbort) return route.abort('failed');
      if (b.token === 'SlowTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') { await new Promise((r) => setTimeout(r, 9500)); }
      const r = TOKENS[b.token] || { ok: false, error: 'not_found' };
      return route.fulfill({ status: r.ok ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r) });
    }
    if (API_RE.test(u)) { st.api.push(u); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, alt: 'API卡', bubble: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'api' }] } }, url: 'https://x.test/' }) }); }
    if (/^https:\/\/line\.me\//.test(u)) { st.nav = u; return route.fulfill({ status: 200, contentType: 'text/html', body: 'line' }); }
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  await page.goto(PAGE + query);
  await page.waitForTimeout(o.wait || 500);
  const t = await page.evaluate(() => window.__t);
  const ui = await page.evaluate(() => ({ ttl: document.getElementById('ttl').textContent, msg: document.getElementById('msg').textContent, btns: Array.from(document.querySelectorAll('#box button')).map((b) => b.textContent) }));
  return { ctx, page, st, t, ui };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const n = encodeURIComponent('科力雲');
    // 1. 養護群組邀請卡：憑 token 向引擎取內容、不打 GAS、跟主系統一致
    {
      const r = await open(browser, '?kind=caregroup&key=' + TOK);
      eq(r.st.api.length, 0, 'caregroup 不向 GAS 取資料');
      eq(r.st.cg.map((x) => x.b), [{ action: 'shareCardGet', token: TOK }], '向引擎 shareCardGet 取一次');
      ok(/^text\/plain/.test(r.st.cg[0].ct), '簡單請求（text/plain、不觸發預檢）');
      ok(r.t.shares.length === 1, '開好友選單一次');
      const msg = r.t.shares[0] && r.t.shares[0][0];
      const g = gasBubble('AbCdEf123_', '科力雲', TOK);
      eq(msg.contents, g.bubble, '分享頁組的卡＝主系統組的卡（整張比對）');
      eq(msg.altText, g.alt, 'altText 一致');
      eq(r.t.shares[0].length, 1, '只分享一張卡、不帶文字');
      const bt = msg.contents.footer.contents[0].contents.map((b) => [b.action.label, b.action.uri]);
      eq(bt, [['加入群組', 'https://line.me/R/ti/g/AbCdEf123_'], ['分享給同事', 'https://liff.line.me/' + LIFF_ID + '?kind=caregroup&key=' + TOK]], '兩顆按鈕；分享按鈕只帶 token（同事收到可再轉）');
      ok(bt[1][1].length <= 1000, '分享網址在 LINE 按鈕長度上限內');
      eq(r.t.closed, 1, '分享完關窗');
      await r.ctx.close();
    }
    // 2. 經 liff.state 進來；網址裡自己帶的代碼與名稱一律忽略
    {
      const r = await open(browser, '?liff.state=' + encodeURIComponent('?kind=caregroup&key=' + TOK));
      eq(r.t.shares[0] && r.t.shares[0][0].contents.header.contents[0].text, '科力雲 x 有植', 'liff.state 也能解出 token');
      await r.ctx.close();
      const r2 = await open(browser, '?kind=caregroup&key=' + TOK + '&g=EvilCode999&n=' + encodeURIComponent('冒名公司') + '&inviteCode=EvilCode999&clientShort=x');
      const c2 = r2.t.shares[0][0].contents;
      ok(JSON.stringify(c2).indexOf('EvilCode999') < 0 && JSON.stringify(c2).indexOf('冒名') < 0 && c2.footer.contents[0].contents[0].action.uri === 'https://line.me/R/ti/g/AbCdEf123_', '網址自帶的代碼與名稱忽略、只用後端回來的');
      await r2.ctx.close();
      const r3 = await open(browser, '?kind=caregroup&g=AbCdEf123_&n=' + encodeURIComponent('科力雲'));
      ok(r3.t.shares.length === 0 && r3.st.cg.length === 0 && /已失效/.test(r3.ui.ttl), '舊式只帶代碼的網址：不出卡、不查後端');
      await r3.ctx.close();
    }
    // 3. 沒有 token、亂填、過期、撤銷、內容不合格：都不產生卡
    for (const [q, name, called] of [['?kind=caregroup', '沒有 token', 0], ['?kind=caregroup&key=abc', '格式不對的 token', 0], ['?kind=caregroup&key=' + 'R'.repeat(43), '亂填 token（後端查無）', 1], ['?kind=caregroup&key=ExpiredTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '過期', 1], ['?kind=caregroup&key=RevokedTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '撤銷', 1], ['?kind=caregroup&key=EvilPayloadTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA', '後端回的代碼不是群組邀請格式', 1], ['?kind=caregroup&key=WrongKindTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'kind 不是 caregroup', 1]]) {
      const r = await open(browser, q);
      ok(r.t.shares.length === 0 && /這張邀請已失效/.test(r.ui.ttl) && r.ui.btns.length === 0, name + '：不產生卡、顯示已失效');
      eq(r.st.cg.length, called, name + '：查後端次數');
      await r.ctx.close();
    }
    {
      const r = await open(browser, '?kind=caregroup&key=XssNameTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      eq(r.t.shares[0][0].contents.header.contents[0].text, '貴公司 x 有植', '後端回的簡稱不合規則＝用貴公司');
      await r.ctx.close();
      const r2 = await open(browser, '?kind=caregroup&key=ServerErrTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      ok(r2.t.shares.length === 0 && /連線失敗/.test(r2.ui.ttl) && r2.ui.btns.indexOf('重試') >= 0, '後端其他錯誤：連線失敗可重試、不出卡');
      await r2.ctx.close();
      const r3 = await open(browser, '?kind=caregroup&key=' + TOK, { cgAbort: true });
      ok(r3.t.shares.length === 0 && /連線失敗/.test(r3.ui.ttl), '連不上：連線失敗、不出卡');
      await r3.ctx.close();
      const r4 = await open(browser, '?kind=caregroup&key=SlowTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { wait: 8800 });
      ok(r4.t.shares.length === 0 && /連線失敗/.test(r4.ui.ttl), '逾時 8 秒：連線失敗、不出卡');
      await r4.ctx.close();
    }
    // 4. 不能分享時：說明＋加入群組按鈕（選單不可用、分享失敗、初始化失敗）
    for (const [o, name] of [[{ picker: false }, '選單不可用'], [{ pickerFail: true }, '分享失敗'], [{ initFail: true }, '初始化失敗']]) {
      const r = await open(browser, '?kind=caregroup&key=' + TOK, o);
      ok(r.ui.btns.indexOf('加入群組') >= 0 && r.ui.msg.length > 0, name + '：顯示說明與加入群組按鈕');
      ok(r.ui.btns.indexOf('複製案例連結') < 0, name + '：不出案例的複製連結');
      await r.page.click('#box button');
      await r.page.waitForTimeout(200);
      eq(r.st.nav, 'https://line.me/R/ti/g/AbCdEf123_', name + '：按鈕開群組邀請網址');
      await r.ctx.close();
    }
    {
      const r = await open(browser, '?kind=caregroup&key=RevokedTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { initFail: true });
      ok(/已失效/.test(r.ui.ttl) && r.ui.btns.length === 0, '初始化失敗＋已撤銷：不出加入按鈕');
      await r.ctx.close();
    }
    // 5. 既有路徑不受影響：packed、kind/key、case、booking
    {
      const d = Buffer.from(JSON.stringify({ f: 'FOLDER123', t: '案例標題' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const r = await open(browser, '?d=' + d);
      ok(r.st.api.length === 0 && r.t.shares[0] && /案例分享/.test(r.t.shares[0][0].altText) && r.t.shares[0][0].contents.header.contents[1].text === '案例標題', 'packed 路徑照舊');
      await r.ctx.close();
      for (const k of ['plant', 'category', 'brand']) {
        const r2 = await open(browser, '?kind=' + k + '&key=' + encodeURIComponent('名稱'));
        ok(r2.st.api.length === 1 && r2.st.api[0].indexOf('page=card-share&kind=' + k) > 0 && r2.t.shares[0][0].altText === 'API卡', k + ' 路徑照舊向後端取卡');
        await r2.ctx.close();
      }
      const r3 = await open(browser, '?case=abc123');
      ok(r3.st.api.length === 1 && r3.st.api[0].indexOf('page=case-share&case=abc123') > 0 && r3.t.shares.length === 1, 'case 路徑照舊');
      await r3.ctx.close();
      const r4 = await open(browser, '?page=booking');
      ok(r4.t.logins === 1 && r4.t.shares.length === 0, 'booking 路徑照舊（未登入先登入）');
      await r4.ctx.close();
      const r5 = await open(browser, '?kind=plant&key=x', { picker: false });
      ok(r5.ui.btns.indexOf('複製案例連結') >= 0, '既有卡不能分享時照舊出複製連結');
      await r5.ctx.close();
    }
  } finally { await browser.close(); }
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
