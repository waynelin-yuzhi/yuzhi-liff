/* 員工 LIFF 共用：LIFF 初始化＋身分＋API＋小工具（第一階段）
 * 身分：LINE 內開 → liff.getIDToken()；外部瀏覽器 → liff.login() 走 LINE Login
 * 封閉測試：?dev=1（可帶 &devToken=…）→ 30 分鐘測試身分（staffLiff op:devToken 發；存 sessionStorage）——只給總管／Wayne 測，不對員工說 */
(function () {
  var CFG = window.STAFF_CFG || {};
  var qs = new URLSearchParams(location.search);
  var S = { ready: false, idToken: '', dev: null, me: null, inLine: false };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function fmtDate(d) {
    var w = ['日', '一', '二', '三', '四', '五', '六'];
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + w[d.getDay()] + '）';
  }
  function showErr(msg) {
    var app = $('app');
    if (app) app.innerHTML = '<div class="card"><div class="err">' + esc(msg) + '</div></div>';
  }

  // 寫入類走引擎單一入口（staffCall；引擎驗身分、代呼 GAS）；引擎連不上才退回直打 GAS。讀取與照片仍直打 GAS
  var WRITE_FNS = { punch: 1, reportSave: 1, photoUpload: 1, reportGet: 1, photoSigned: 1, draftSave: 1, draftDelete: 1, coachReply: 1, schedDraft: 1, schedMove: 1, schedMoveBatch: 1, schedSubmit: 1, schedWithdraw: 1, schedFixHolidays: 1, schedMergeManual: 1, schedApprove: 1, schedReject: 1, schedChangeDecide: 1 };
  function cleanParams(params) { var o = {}; Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) o[k] = String(params[k]); }); return o; }
  function enginePayload(fn, params) { var b = { fn: fn, params: cleanParams(params) }; if (S.dev) b.devToken = S.dev.token; else b.idToken = S.idToken || ''; return b; }
  function apiGas(fn, params) {
    var body = new URLSearchParams();
    body.append('fn', fn);
    if (S.dev) body.append('devToken', S.dev.token);
    else body.append('idToken', S.idToken || '');
    Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k])); });
    return fetch(CFG.api + '?staff=1', { method: 'POST', body: body, redirect: 'follow', cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  // 只有「引擎有回應、但它那端出問題」才退回直打 GAS（5xx／連不上 GAS／並行期鏡像還沒跟上的 not_staff）；
  // 手機斷線這種沒有回應的錯不重送——引擎可能已經替你寫進去了，重送會變兩筆（審查 MEDIUM 2026-10-25）
  function fallbackErr(code) { var e = new Error(code); e.fallback = true; return e; }
  function apiEngine(fn, params) {
    return fetch(CFG.engine + '?action=staffCall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(enginePayload(fn, params)), cache: 'no-store' })
      .then(function (r) { if (r.status >= 500) throw fallbackErr('engine_' + r.status); return r.json(); })
      .then(function (j) { if (j && (j.error === 'gas_unreachable' || j.error === 'gas_bad_response' || j.error === 'not_staff' || j.error === 'engine_not_configured' || j.error === 'no_token' || j.error === 'emp_not_found' || j.error === 'fn_not_allowed')) throw fallbackErr(j.error); return j; });   // no_token＝GAS 不認引擎鑰（2026-10-25 逸琳回報卡住實案）：一律退回直打，不能讓員工卡住
  }
  // LINE idToken 約 1 小時到期：頁面開著放久（PWA／分頁沒關）再按打卡會回「IdToken expired」（逸琳 2026-11-03 實案）。
  // 每次呼叫前看 token 的 exp，剩不到 2 分鐘就先在 LINE 內無痛重新登入（liff.login 在 LINE 裡不會跳畫面）、回來再請她按一次；後端已回過期也同樣處理。
  function tokenExpMs() { try { var seg = String(S.idToken || '').split('.')[1] || ''; var js = JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/'))); return Number(js.exp || 0) * 1000; } catch (e) { return 0; } }
  var RELOGIN_KEY = 'staff_relogin_at';
  function relogin(why) {
    try { sessionStorage.setItem(RELOGIN_KEY, String(Date.now())); } catch (e) {}
    try { if (window.liff && liff.isLoggedIn && liff.isLoggedIn()) liff.logout(); } catch (e) {}
    try { liff.login({ redirectUri: location.href }); } catch (e) { showErr('LINE 登入已過期，請關閉後重新從 LINE 開啟。'); }
    return new Promise(function () {});   // 轉去登入、不再往下跑
  }
  function ensureFreshToken() {
    if (S.dev || !S.idToken || !window.liff) return Promise.resolve();
    var exp = tokenExpMs(); if (!exp || exp - Date.now() > 120000) return Promise.resolve();
    return relogin('expiring');
  }
  function tokenExpired(j) { return !!(j && !S.dev && (j.error === 'token_invalid' || /IdToken expired|token_invalid/i.test(String(j.detail || '')))); }
  function api(fn, params) {
    // 部分版（照片還沒傳完先存一份）只准走引擎：退回 GAS 會把半套照片當正式報告寫進試算表
    var engineOnly = !!(params && params.partial === '1');
    return ensureFreshToken().then(function () {
      var p = (WRITE_FNS[fn] && CFG.engine) ? apiEngine(fn, params).catch(function (e) { if (e && e.fallback && !engineOnly) return apiGas(fn, params); throw e; }) : apiGas(fn, params);
      return p.then(function (j) {
        if (tokenExpired(j)) return relogin('expired');
        if (j && j.error === 'exception') j.detail = '後台暫時出錯，請再試一次。';   // 後端只回 server_error，白話統一在這裡換
        return j;
      });
    });
  }

  function devSetup() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('staff_dev') || 'null'); } catch (e) {}
    var fromUrl = qs.get('devToken');
    if (fromUrl) { saved = { token: fromUrl.trim() }; try { sessionStorage.setItem('staff_dev', JSON.stringify(saved)); } catch (e) {} }
    if (!saved) {
      var t = window.prompt('封閉測試：貼上測試身分 token');
      if (!t) return null;
      saved = { token: t.trim() };
      try { sessionStorage.setItem('staff_dev', JSON.stringify(saved)); } catch (e) {}
    }
    return saved;
  }

  // 初始化：回 Promise<me>；頁面自己決定拿到身分後畫什麼。opts.skipWhoami＝只拿身分 token、頁面自己打合併 API（打卡頁一趟到位）
  function init(opts) {
    opts = opts || {};
    // 開頁別等 GAS whoami（5～10 秒）：首頁存過的身分（3 天內）先用、背景再更新；要最新身分的頁自己再呼叫 whoami（2026-11-03 Wayne 要開頁快五成）
    var after = opts.skipWhoami ? function () { return Promise.resolve(null); } : function () {
      var cached = cacheGet('home');
      if (cached && (cached.empId || (cached.emp && cached.emp.empId))) { S.me = cached; S.ready = true; setTimeout(function () { whoami().catch(function () {}); }, 1500); return Promise.resolve(cached); }
      return whoami();
    };
    if (qs.get('dev') === '1') {
      S.dev = devSetup();
      if (!S.dev) { showErr('沒有測試身分、無法載入。'); return Promise.reject(new Error('no dev')); }
      return after();
    }
    if (!window.liff) { showErr('LIFF SDK 載入失敗，請關閉後重新從 LINE 開啟。'); return Promise.reject(new Error('no liff')); }
    if (!CFG.liffId) { showErr('員工 App 尚未設定完成（LIFF ID 未填）。'); return Promise.reject(new Error('no liffId')); }
    return liff.init({ liffId: CFG.liffId }).then(function () {
      S.inLine = liff.isInClient();
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return new Promise(function () {}); }
      S.idToken = liff.getIDToken() || '';
      if (!S.idToken) { showErr('拿不到 LINE 身分，請關閉後重新從 LINE 開啟。'); return Promise.reject(new Error('no token')); }
      var expNow = tokenExpMs(); if (expNow && expNow - Date.now() < 120000) return relogin('stale_at_init');   // 快取的舊 token 一開頁就快過期：先換新的
      try { var rl = Number(sessionStorage.getItem(RELOGIN_KEY) || 0); if (rl && Date.now() - rl < 120000) { sessionStorage.removeItem(RELOGIN_KEY); setTimeout(function () { try { var ns = window.STAFF || window.T; if (ns && typeof ns.toast === 'function') ns.toast('已重新登入，請再按一次剛才的動作'); else alert('已重新登入，請再按一次剛才的動作'); } catch (e) {} }, 400); } } catch (e) {}
      // 頁面放到背景再回來（PWA 常見）：先檢查 token，過期就先換，免得按下去才失敗
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') ensureFreshToken(); });
      return after();
    }).catch(function (e) {
      showErr('LIFF 初始化失敗：' + (e && e.message ? e.message : e));
      throw e;
    });
  }
  var ERR_MSG = { exception: '後台暫時出錯，請再試一次。', not_staff: '這個 LINE 帳號還沒綁定員工，請聯絡 Wayne 綁定後再試。', not_configured: '員工 App 尚未設定完成（後端未設 channel）。', token_invalid: 'LINE 身分驗證失敗，請關閉後重新從 LINE 開啟。', no_token: '沒有 LINE 身分。', dev_token_invalid: '測試身分過期，請重新取得。' };
  function errText(r) { return ERR_MSG[r && r.error] || ('載入失敗：' + ((r && (r.detail || r.error)) || '')); }
  function whoami() {
    return api('whoami').then(function (r) {
      if (!r || !r.ok) { showErr(errText(r)); throw new Error(r && r.error); }
      S.me = r; S.ready = true; cacheSet('home', r);
      return r;
    });
  }

  // 定位：回 Promise<{lat,lng,acc}>；失敗 resolve null（打卡仍可送、後端記「無定位」）
  function locate(timeoutMs) {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs || 12000);
      navigator.geolocation.getCurrentPosition(function (p) {
        if (done) return; done = true; clearTimeout(t);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      }, function () { if (done) return; done = true; clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs || 12000, maximumAge: 20000 });
    });
  }
  function distanceM(lat1, lon1, lat2, lon2) {
    var R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  // 開外部頁（養護報告舊 App 等）：LINE 內用 liff.openWindow external、否則新分頁
  function openExternal(url) {
    if (window.liff && S.inLine) liff.openWindow({ url: url, external: true });
    else window.open(url, '_blank');
  }
  // 本機快取（同一支手機＝同一位員工）：上次載到的資料先畫、API 回來再換——GAS 每趟 4–8 秒，Wayne 2026-08-18 實測「有點慢」
  function cacheGet(key) { try { var v = JSON.parse(localStorage.getItem('staff_c_' + key) || 'null'); return (v && Date.now() - v.t < 3 * 86400000) ? v.d : null; } catch (e) { return null; } }
  function cacheSet(key, d) { try { localStorage.setItem('staff_c_' + key, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {} }
  // 頁內連結保留 dev／test 參數
  function href(page, params) {
    var u = new URLSearchParams(params || {});
    if (qs.get('dev') === '1') u.set('dev', '1');
    if (qs.get('test') === '1') u.set('test', '1');
    var q = u.toString();
    return page + (q ? '?' + q : '');
  }

  // 版本鮮度：LINE webview／GitHub Pages 會快取舊 HTML（Wayne 2026-08-18 點養護報告開到舊 App）。
  // 每次開頁抓 version.json（帶時間戳＝不走快取），跟載入中的 config 版本比，不同就用新查詢字串重載一次（只重載一次、防迴圈）。
  (function freshness() {
    try {
      var guard = sessionStorage.getItem('staff_fresh_' + (CFG.version || ''));
      fetch('version.json?ts=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) {
        if (!v || !v.version || v.version === CFG.version || guard) return;
        try { sessionStorage.setItem('staff_fresh_' + (CFG.version || ''), '1'); } catch (e) {}
        var u = new URL(location.href); u.searchParams.set('_', String(Date.now()));
        location.replace(u.toString());
      }).catch(function () {});
    } catch (e) {}
  })();

  // 每頁頁首注入「‹ 員工首頁」（首頁本身除外）
  function injectTopbar() {
    try {
      if (/index\.html$|\/staff\/?$/.test(location.pathname)) return;
      var app0 = document.getElementById('app');
      if (app0 && !document.querySelector('.topbar')) { var tb = document.createElement('div'); tb.className = 'topbar'; tb.innerHTML = '<a href="' + href('index.html') + '">‹ 員工首頁</a>'; app0.parentNode.insertBefore(tb, app0); }
    } catch (eT) {}
  }
  // staff.js 在 <head> 載入，#app 還不存在，等 DOM 好了再注入
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectTopbar); else injectTopbar();
  function beacon(fn, params) {   // 離開頁面時的最後一送（fire-and-forget）：寫入類送引擎 staffCall（text/plain 不觸發預檢）、其餘直打 GAS
    try { if (!navigator.sendBeacon) return false;
      if (WRITE_FNS[fn] && CFG.engine) return navigator.sendBeacon(CFG.engine + '?action=staffCall', new Blob([JSON.stringify(enginePayload(fn, params))], { type: 'text/plain' }));
      var body = new URLSearchParams(); body.append('fn', fn); if (S.dev) body.append('devToken', S.dev.token); else body.append('idToken', S.idToken || ''); Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k])); }); return navigator.sendBeacon(CFG.api + '?staff=1', body); } catch (e) { return false; }
  }
  window.STAFF = { S: S, CFG: CFG, beacon: beacon, qs: qs, esc: esc, $: $, fmtDate: fmtDate, showErr: showErr, errText: errText, api: api, init: init, cacheGet: cacheGet, cacheSet: cacheSet, locate: locate, distanceM: distanceM, openExternal: openExternal, href: href };
})();
