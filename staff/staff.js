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

  function api(fn, params) {
    var body = new URLSearchParams();
    body.append('fn', fn);
    if (S.dev) body.append('devToken', S.dev.token);
    else body.append('idToken', S.idToken || '');
    Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k])); });
    return fetch(CFG.api + '?staff=1', { method: 'POST', body: body, redirect: 'follow', cache: 'no-store' })
      .then(function (r) { return r.json(); });
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
    var after = opts.skipWhoami ? function () { return Promise.resolve(null); } : whoami;
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
      return after();
    }).catch(function (e) {
      showErr('LIFF 初始化失敗：' + (e && e.message ? e.message : e));
      throw e;
    });
  }
  var ERR_MSG = { not_staff: '這個 LINE 帳號還沒綁定員工，請聯絡 Wayne 綁定後再試。', not_configured: '員工 App 尚未設定完成（後端未設 channel）。', token_invalid: 'LINE 身分驗證失敗，請關閉後重新從 LINE 開啟。', no_token: '沒有 LINE 身分。', dev_token_invalid: '測試身分過期，請重新取得。' };
  function errText(r) { return ERR_MSG[r && r.error] || ('載入失敗：' + ((r && (r.detail || r.error)) || '')); }
  function whoami() {
    return api('whoami').then(function (r) {
      if (!r || !r.ok) { showErr(errText(r)); throw new Error(r && r.error); }
      S.me = r; S.ready = true;
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

  window.STAFF = { S: S, CFG: CFG, qs: qs, esc: esc, $: $, fmtDate: fmtDate, showErr: showErr, errText: errText, api: api, init: init, cacheGet: cacheGet, cacheSet: cacheSet, locate: locate, distanceM: distanceM, openExternal: openExternal, href: href };
})();
