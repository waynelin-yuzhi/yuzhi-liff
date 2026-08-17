/* 養護報告（LIFF）：功能與舊 App CareReport 同律、動線重做
 * 資料模型（與後端 saveCareReport 同形）：{ reportId, clientId, clientName, reportDate, startTime, endTime, tasks[], notes,
 *   zones:[{ seq, name, caption, beforePhotos:[url], afterPhotos:[url], pendingBefore:[{id,dataUri,status,url}], pendingAfter:[...], issues:[...] }], issueProposals:{ref:{proposalType,note}} }
 * 照片：選完即壓縮（長邊 2560／0.85）→ 立刻背景上傳；dataUri 存 IndexedDB（跳頁不掉）；送出走佇列（沒傳完的補傳→存報告）
 * 草稿：本機快照（localStorage、即時）＋雲端草稿（debounce 1.5 秒、照片只存 URL）
 */
(function () {
  var T = window.STAFF, esc = T.esc, $ = T.$;
  var TASKS = ['澆水', '修剪枯葉', '清理水盤', '施藥', '施肥', '換盆', '植物更換', '病蟲害處理', '自動澆水檢查'];
  var ISSUE_TYPES = ['蟲害', '爛根', '自然代謝', '光線不足', '大量落葉', '乾濕不均勻', '土壤過乾', '積水', '自訂'];
  var STATUSES = ['已處理', '待追蹤', '需換植物'];
  var SEVS = ['觀察', '需處理', '急'];
  var PLANTS = ['龜背芋', '虎尾蘭', '琴葉榕', '天堂鳥', '黃金葛', '蔓綠絨', '火鶴', '粗肋草', '鹿角蕨', '竹芋', '金錢樹', '橡膠樹', '馬拉巴栗', '山蘇', '腎蕨', '袖珍椰子', '白鶴芋', '幸福樹', '雞蛋花', '棕竹'];
  var LS_KEY = 'staff_report_form';
  var preClient = (T.qs.get('client') || '').trim();

  var A = { me: null, sites: [], promoted: [], view: 'form', st: null, dirty: false, draftTimer: null, draftStatus: '', serverDraft: null,
            openIssues: [], proposals: {}, siteInfoOpen: false, list: null, submitting: false, editing: false, up: {} };

  function types() { return A.promoted.length ? ISSUE_TYPES.filter(function (t) { return t !== '自訂'; }).concat(A.promoted, ['自訂']) : ISSUE_TYPES; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function newZone(seq) { return { seq: seq, name: '', caption: '', beforePhotos: [], afterPhotos: [], pendingBefore: [], pendingAfter: [], issues: [] }; }
  function initial() { return { reportId: '', clientId: '', clientName: '', reportDate: todayIso(), startTime: '', endTime: '', timesFromCheckin: false, tasks: [], notes: '', zones: [newZone(1)] }; }
  function siteById(id) { for (var i = 0; i < A.sites.length; i++) if (A.sites[i].id === id) return A.sites[i]; return null; }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ── IndexedDB：pending 照片（dataUri）＋送出佇列 ──
  var dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var r = indexedDB.open('yz_staff_report', 1);
      r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }); if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function store(name, mode, fn) { return idb().then(function (d) { return new Promise(function (res, rej) { var tx = d.transaction(name, mode); var s = tx.objectStore(name); var out = fn(s); tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; tx.onerror = function () { rej(tx.error); }; }); }).catch(function () { return null; }); }
  function photoPut(ph) { return store('photos', 'readwrite', function (s) { s.put({ id: ph.id, dataUri: ph.dataUri, url: ph.url || '', status: ph.status }); }); }
  function photoDel(id) { return store('photos', 'readwrite', function (s) { s.delete(id); }); }
  function photoAll() { return idb().then(function (d) { return new Promise(function (res) { var out = []; var c = d.transaction('photos').objectStore('photos').openCursor(); c.onsuccess = function (e) { var cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; c.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function queueAll() { return idb().then(function (d) { return new Promise(function (res) { var out = []; var c = d.transaction('queue').objectStore('queue').openCursor(); c.onsuccess = function (e) { var cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; c.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function queuePut(rec) { return store('queue', 'readwrite', function (s) { return s.put(rec); }); }
  function queueDel(id) { return store('queue', 'readwrite', function (s) { s.delete(id); }); }

  // ── 本機快照／雲端草稿 ──
  function snapshot() {
    try {
      var s = JSON.parse(JSON.stringify(A.st));
      s.zones.forEach(function (z) { z.pendingBefore = z.pendingBefore.map(function (p) { return { id: p.id, status: p.status, url: p.url || '' }; }); z.pendingAfter = z.pendingAfter.map(function (p) { return { id: p.id, status: p.status, url: p.url || '' }; }); });
      localStorage.setItem(LS_KEY, JSON.stringify({ t: Date.now(), st: s, proposals: A.proposals, editing: A.editing }));
    } catch (e) {}
  }
  function clearSnapshot() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
  function markDirty() { A.dirty = true; snapshot(); if (A.draftTimer) clearTimeout(A.draftTimer); A.draftTimer = setTimeout(saveDraft, 1500); }
  function stripped() { var s = JSON.parse(JSON.stringify(A.st)); s.zones.forEach(function (z) { z.pendingBefore = []; z.pendingAfter = []; }); s.issueProposals = A.proposals; return s; }
  function saveDraft() {
    if (!A.dirty) return;
    var hasContent = A.st.clientId || A.st.notes || A.st.tasks.length || A.st.zones.some(function (z) { return z.name || z.caption || z.issues.length || z.pendingBefore.length || z.pendingAfter.length; });
    if (!hasContent) return;
    T.api('draftSave', { payloadJson: JSON.stringify(stripped()) }).then(function (r) {
      A.dirty = false;
      if (r && r.ok) { var t = new Date(r.updatedAt || Date.now()); A.draftStatus = '草稿已存 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); }
      else A.draftStatus = '草稿暫存失敗、稍後再試';
      var el = $('draft-status'); if (el) el.textContent = A.draftStatus;
    }).catch(function () { var el = $('draft-status'); if (el) el.textContent = '草稿暫存失敗（離線？）'; });
  }
  function restoreLocal() {
    var snap = null; try { snap = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
    if (!snap || !snap.st) return Promise.resolve(false);
    A.st = snap.st; A.proposals = snap.proposals || {}; A.editing = !!snap.editing;
    A.st.zones.forEach(function (z) { z.pendingBefore = z.pendingBefore || []; z.pendingAfter = z.pendingAfter || []; z.beforePhotos = z.beforePhotos || []; z.afterPhotos = z.afterPhotos || []; z.issues = z.issues || []; });
    return photoAll().then(function (all) {
      var map = {}; all.forEach(function (p) { map[p.id] = p; });
      A.st.zones.forEach(function (z) {
        ['pendingBefore', 'pendingAfter'].forEach(function (k) {
          z[k] = z[k].map(function (p) { var m = map[p.id]; if (!m) return null; return { id: p.id, dataUri: m.dataUri, status: (m.url || p.url) ? 'done' : 'failed', url: m.url || p.url || '' }; }).filter(Boolean);
        });
      });
      return true;
    });
  }
  function restoreServerDraft() {
    return T.api('draftGet').then(function (r) {
      if (!(r && r.ok && r.data && r.data.payloadJson)) return false;
      try {
        var s = JSON.parse(r.data.payloadJson);
        s.zones = (s.zones || []).map(function (z, i) { return { seq: z.seq || i + 1, name: z.name || '', caption: z.caption || '', beforePhotos: z.beforePhotos || [], afterPhotos: z.afterPhotos || [], pendingBefore: [], pendingAfter: [], issues: z.issues || [] }; });
        if (!s.zones.length) s.zones = [newZone(1)];
        A.proposals = s.issueProposals || {}; delete s.issueProposals;
        A.st = Object.assign(initial(), s); A.editing = !!A.st.reportId;
        return true;
      } catch (e) { return false; }
    });
  }
  function discardAll() {
    A.st = initial(); A.proposals = {}; A.editing = false; A.serverDraft = null; A.dirty = false;
    clearSnapshot(); T.api('draftDelete');
    photoAll().then(function (all) { all.forEach(function (p) { photoDel(p.id); }); });
  }

  // ── 照片：壓縮／上傳 ──
  function compress(file, maxEdge, q) {
    return new Promise(function (res) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, maxEdge / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', q));
        } catch (e) { res(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  function onPhotos(files, zi, ba) {
    var z = A.st.zones[zi], key = ba === 'before' ? 'pendingBefore' : 'pendingAfter';
    Promise.all(Array.prototype.map.call(files, function (f) { return compress(f, 2560, 0.85); })).then(function (uris) {
      var added = [];
      uris.forEach(function (u) {
        if (!u) return;
        if (z[key].some(function (p) { return p.dataUri === u; })) return;
        var ph = { id: uid(), dataUri: u, status: 'uploading', url: '' };
        z[key].push(ph); added.push(ph); photoPut(ph);
      });
      renderThumbs(zi, ba); markDirty();
      added.forEach(function (ph) { uploadOne(ph, zi, ba); });
    });
  }
  function uploadOne(ph, zi, ba) {
    var z = A.st.zones[zi]; if (!z) return;
    ph.status = 'uploading'; renderThumbs(zi, ba);
    T.api('photoUpload', { dataUri: ph.dataUri, reportId: A.st.reportId || '', clientName: A.st.clientName || '未指定客戶', zoneSeq: z.seq, beforeAfter: ba }).then(function (r) {
      if (r && r.ok) { ph.status = 'done'; ph.url = r.url; } else ph.status = 'failed';
      photoPut(ph); renderThumbs(zi, ba); snapshot();
    }).catch(function () { ph.status = 'failed'; photoPut(ph); renderThumbs(zi, ba); });
  }
  function uploadUnsent() { A.st.zones.forEach(function (z, zi) { z.pendingBefore.forEach(function (p) { if (p.status !== 'done') uploadOne(p, zi, 'before'); }); z.pendingAfter.forEach(function (p) { if (p.status !== 'done') uploadOne(p, zi, 'after'); }); }); }
  function mergedPhotos(z, kind) { var up = kind === 'before' ? z.beforePhotos : z.afterPhotos, pd = kind === 'before' ? z.pendingBefore : z.pendingAfter; return up.map(function (u) { return { src: u }; }).concat(pd.map(function (p) { return { src: p.dataUri || p.url }; })); }
  function delPhoto(zi, ba, kind, k) {
    var z = A.st.zones[zi];
    if (kind === 'uploaded') (ba === 'before' ? z.beforePhotos : z.afterPhotos).splice(k, 1);
    else { var arr = ba === 'before' ? z.pendingBefore : z.pendingAfter; var ph = arr[k]; arr.splice(k, 1); if (ph) photoDel(ph.id); }
    var upN = (ba === 'before' ? z.beforePhotos : z.afterPhotos).length;
    var idx = kind === 'uploaded' ? k : upN + k;
    z.issues.forEach(function (iss) { if (iss.repPhoto && iss.repPhoto.kind === ba) { if (iss.repPhoto.idx === idx) iss.repPhoto = null; else if (iss.repPhoto.idx > idx) iss.repPhoto.idx--; } });
    renderZones(); markDirty();
  }

  // ── 異常 ──
  function deriveDesc(iss) {
    var base = iss.type === '自訂' ? (iss.customDesc || '自訂') : iss.type;
    var plant = String(iss.plant || '').trim(); if (plant) base = plant + ' ' + base;
    var bits = []; if (iss.severity && iss.severity !== '需處理') bits.push(iss.severity);
    var pw = String(iss.potW || '').trim(), ph = String(iss.potH || '').trim(); if (pw || ph) bits.push('盆' + (pw || '?') + '×' + (ph || '?') + 'cm');
    if (iss.note) bits.push(iss.note);
    return bits.length ? base + '（' + bits.join('・') + '）' : base;
  }
  function normIssue(iss) {
    if (!iss) return null;
    if (!iss.type) { var d = iss.desc || ''; var mt = types().filter(function (t) { return t !== '自訂' && d.indexOf(t) >= 0; })[0]; iss = { type: mt || '自訂', customDesc: mt ? '' : d, note: '', status: iss.status || '待追蹤', plant: iss.plant || '', severity: iss.severity || '需處理', potW: iss.potW || '', potH: iss.potH || '', repPhoto: null, desc: d || mt || '自訂', continuedFrom: iss.continuedFrom || null }; }
    ['plant', 'potW', 'potH', 'note', 'customDesc'].forEach(function (k) { if (iss[k] === undefined) iss[k] = ''; });
    if (iss.severity === undefined) iss.severity = '需處理'; if (iss.status === undefined) iss.status = '待追蹤'; if (iss.repPhoto === undefined) iss.repPhoto = null;
    return iss;
  }
  function addIssue(zi, type) { var iss = normIssue({ type: type, customDesc: '', note: '', status: '待追蹤', plant: '', severity: '需處理', potW: '', potH: '', repPhoto: null, desc: type }); iss.desc = deriveDesc(iss); A.st.zones[zi].issues.push(iss); A.pickerOpen = null; renderZones(); markDirty(); }
  function updIssue(zi, k, key, v) { var iss = A.st.zones[zi].issues[k]; if (!iss) return; iss[key] = v; iss.desc = deriveDesc(iss); markDirty(); }

  // ── 上次未結異常：提議＋「狀況一樣」自動延續 ──
  function setProposal(i, type) {
    var oi = A.openIssues[i]; if (!oi) return;
    var prev = A.proposals[oi.ref] && A.proposals[oi.ref].proposalType;
    if (prev === type) { delete A.proposals[oi.ref]; if (prev === '狀況一樣') syncContinued(oi, 'remove'); }
    else { A.proposals[oi.ref] = { proposalType: type, note: (A.proposals[oi.ref] && A.proposals[oi.ref].note) || '' }; if (prev === '狀況一樣' && type !== '狀況一樣') syncContinued(oi, 'remove'); if (type === '狀況一樣') syncContinued(oi, 'add'); }
    markDirty(); render();
  }
  function syncContinued(oi, mode) {
    if (mode === 'add') {
      if (A.st.zones.some(function (z) { return z.issues.some(function (i) { return i.continuedFrom === oi.ref; }); })) return;
      var zi = -1; A.st.zones.forEach(function (z, i) { if (zi < 0 && (z.name || '') === (oi.zoneName || '')) zi = i; });
      if (zi < 0) { A.st.zones.push(newZone(A.st.zones.length + 1)); zi = A.st.zones.length - 1; A.st.zones[zi].name = oi.zoneName || ''; }
      var d = oi.desc || ''; var mt = types().filter(function (t) { return t !== '自訂' && d.indexOf(t) >= 0; })[0];
      A.st.zones[zi].issues.push({ type: mt || '自訂', customDesc: mt ? '' : d, note: '', status: '待追蹤', plant: oi.plant || '', severity: oi.severity || '需處理', potW: oi.potW || '', potH: oi.potH || '', repPhoto: null, desc: d || mt || '自訂', continuedFrom: oi.ref });
    } else A.st.zones.forEach(function (z) { z.issues = z.issues.filter(function (i) { return i.continuedFrom !== oi.ref; }); });
  }
  function loadOpenIssues(clientId) {
    A.openIssues = []; A.openLoading = true; renderOpen();
    T.api('openIssues', { clientId: clientId }).then(function (r) { A.openLoading = false; A.openIssues = (r && r.ok && r.issues) || []; renderOpen(); }).catch(function () { A.openLoading = false; renderOpen(); });
  }
  function daysAgo(ds) { if (!ds) return ''; var d = new Date(ds + 'T00:00:00'); var n = Math.round((Date.now() - d.getTime()) / 86400000); if (isNaN(n)) return ''; return n <= 0 ? '今天' : (n + ' 天前'); }

  // ── 時間自動帶入 ──
  function loadTimes() {
    if (!A.st.clientId || !A.st.reportDate) return;
    var el = $('time-hint'); if (el) { el.textContent = '查打卡紀錄…'; el.className = 'hint'; }
    T.api('checkinTimes', { clientId: A.st.clientId, date: A.st.reportDate }).then(function (r) {
      var el2 = $('time-hint'); if (!el2) return;
      if (!(r && r.ok)) { el2.textContent = ''; return; }
      if (!r.data) { el2.textContent = '該日沒有這家的打卡紀錄，請手動填'; el2.className = 'hint warn'; return; }
      var sE = !A.st.startTime, eE = !A.st.endTime;
      if (sE && r.data.startTime) { A.st.startTime = r.data.startTime; var si = $('f-start'); if (si) si.value = A.st.startTime; }
      if (eE && r.data.endTime) { A.st.endTime = r.data.endTime; var ei = $('f-end'); if (ei) ei.value = A.st.endTime; }
      var msg = r.data.startTime && r.data.endTime ? '來自打卡：' + r.data.startTime + '–' + r.data.endTime : (r.data.startTime ? '來自打卡：' + r.data.startTime + '（尚未打離開）' : '來自打卡：—–' + r.data.endTime);
      if (!sE || !eE) msg += '（保留你手填的）';
      el2.textContent = msg; el2.className = 'hint ok'; A.st.timesFromCheckin = sE && eE; snapshot();
    });
  }

  // ── 渲染 ──
  function render() {
    if (A.view === 'list') { renderList(); return; }
    var st = A.st, h = '';
    if (A.serverDraft && !A.serverDraftDismissed) {
      var t = new Date(A.serverDraft.updatedAt || 0);
      h += '<div class="card" style="border:1.5px solid var(--amber)"><div class="note" style="color:var(--body)">雲端有一份未完成的草稿' + (A.serverDraft.clientName ? '：' + esc(A.serverDraft.clientName) : '') + '（' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + '）</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" id="dr-restore">恢復</button><button class="btn sm secondary" id="dr-discard">丟棄</button><button class="btn sm secondary" id="dr-later">先不管</button></div></div>';
    }
    if (A.editing && st.reportId) h += '<div class="editing"><span>編輯中：' + esc(st.clientName || '') + ' ' + esc(st.reportDate) + '</span><button class="btn sm secondary" id="new-report">建立新報告</button></div>';
    // 基本
    h += '<div class="card"><div class="fld"><label>客戶</label><select id="f-client"><option value="">選擇客戶…</option>' + A.sites.map(function (s) { return '<option value="' + esc(s.id) + '"' + (st.clientId === s.id ? ' selected' : '') + '>' + esc(s.shortName || s.name) + (s.today ? '（今天）' : '') + '</option>'; }).join('') + '</select></div>'
      + '<div class="two"><div class="fld"><label>養護日期</label><input type="date" id="f-date" value="' + esc(st.reportDate) + '"></div><div class="fld"><label>服務時間</label><div style="display:flex;gap:6px;align-items:center"><input type="time" id="f-start" value="' + esc(st.startTime) + '"><span>–</span><input type="time" id="f-end" value="' + esc(st.endTime) + '"></div></div></div>'
      + '<div class="hint" id="time-hint"></div></div>';
    // 案場資訊
    var site = siteById(st.clientId);
    if (site && (site.careNote || site.accessMethod || site.plantSummary || site.address)) {
      h += '<div class="card"><div class="collapse-h" id="site-toggle"><h2 style="margin:0">案場資訊</h2><span class="note">' + (A.siteInfoOpen ? '收合' : '展開') + '</span></div>'
        + (A.siteInfoOpen ? '<div class="site-info" style="margin-top:8px">' + (site.address ? '地址：' + esc(site.address) + '\n' : '') + (site.accessMethod ? '進出：' + esc(site.accessMethod) + '\n' : '') + (site.careNote ? '注意：' + esc(site.careNote) + '\n' : '') + (site.plantSummary ? '植栽：' + esc(site.plantSummary) : '') + '</div>' : '') + '</div>';
    }
    // 上次未結異常
    h += '<div id="open-wrap"></div>';
    // 任務
    h += '<div class="card"><h2>養護項目</h2><div class="chips">' + TASKS.map(function (t) { return '<button type="button" class="chip-btn' + (st.tasks.indexOf(t) >= 0 ? ' on' : '') + '" data-task="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>';
    // 區域
    h += '<div class="card"><h2>區域記錄</h2><div id="zones"></div><button class="btn secondary sm" id="add-zone" style="width:100%">＋ 新增區域</button></div>';
    // 備註
    h += '<div class="card"><h2>養護師備註</h2><textarea id="f-notes" placeholder="整體狀況、給後台的話…">' + esc(st.notes) + '</textarea></div>';
    // 送出
    h += '<div class="sticky"><div id="qbar"></div><button class="btn" id="submit"' + (A.submitting ? ' disabled' : '') + '>' + (A.editing && st.reportId ? '更新報告' : '送出報告') + '</button><div class="note" style="text-align:center;margin-top:6px" id="draft-status">' + esc(A.draftStatus) + '</div></div>';
    $('app').innerHTML = h;
    renderZones(); renderOpen(); renderQueueBar();
    // 綁定
    var sel = $('f-client'); sel.addEventListener('change', function () { st.clientId = sel.value; var o = siteById(sel.value); st.clientName = o ? (o.shortName || o.name) : ''; A.proposals = {}; markDirty(); render(); if (st.clientId) { loadOpenIssues(st.clientId); loadTimes(); } });
    $('f-date').addEventListener('change', function () { st.reportDate = this.value; markDirty(); loadTimes(); });
    $('f-start').addEventListener('change', function () { st.startTime = this.value; st.timesFromCheckin = false; markDirty(); });
    $('f-end').addEventListener('change', function () { st.endTime = this.value; st.timesFromCheckin = false; markDirty(); });
    $('f-notes').addEventListener('input', function () { st.notes = this.value; markDirty(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-task]'), function (b) { b.addEventListener('click', function () { var t = b.getAttribute('data-task'); var i = st.tasks.indexOf(t); if (i >= 0) st.tasks.splice(i, 1); else st.tasks.push(t); b.classList.toggle('on'); markDirty(); }); });
    $('add-zone').addEventListener('click', function () { st.zones.push(newZone(st.zones.length + 1)); renderZones(); markDirty(); });
    $('submit').addEventListener('click', submit);
    var stg = $('site-toggle'); if (stg) stg.addEventListener('click', function () { A.siteInfoOpen = !A.siteInfoOpen; render(); });
    var nr = $('new-report'); if (nr) nr.addEventListener('click', function () { if (confirm('放棄目前編輯、建立新的一份？')) { discardAll(); render(); } });
    var dr = $('dr-restore'); if (dr) dr.addEventListener('click', function () { restoreServerDraft().then(function (ok) { A.serverDraft = null; if (ok) { snapshot(); render(); if (A.st.clientId) { loadOpenIssues(A.st.clientId); } } else alert('草稿格式錯誤'); }); });
    var dd = $('dr-discard'); if (dd) dd.addEventListener('click', function () { if (confirm('丟棄雲端這份草稿？')) { T.api('draftDelete'); A.serverDraft = null; render(); } });
    var dl = $('dr-later'); if (dl) dl.addEventListener('click', function () { A.serverDraftDismissed = true; render(); });
    if (st.clientId && !A.openIssuesLoadedFor) { A.openIssuesLoadedFor = st.clientId; loadOpenIssues(st.clientId); if (!st.startTime && !st.endTime) loadTimes(); }
  }
  function renderOpen() {
    var w = $('open-wrap'); if (!w) return;
    if (!A.st.clientId) { w.innerHTML = ''; return; }
    if (A.openLoading) { w.innerHTML = '<div class="card"><h2>上次未結案異常</h2><div class="note">載入中…</div></div>'; return; }
    if (!A.openIssues.length) { w.innerHTML = '<div class="card"><h2>上次未結案異常</h2><div class="note">這家目前沒有未結案的異常。</div></div>'; return; }
    w.innerHTML = '<div class="card"><h2>上次未結案異常（' + A.openIssues.length + '）</h2>' + A.openIssues.map(function (oi, i) {
      var sel = A.proposals[oi.ref] && A.proposals[oi.ref].proposalType;
      var hint = sel === '狀況一樣' ? '會自動延續到本次區域異常，不用重填' : (sel === '已處理' ? '主管確認後結案、下次不再出現' : (sel === '需要換植' ? '後台會排補貨並通知客戶' : ''));
      return '<div class="oi"><div class="d">' + esc(oi.desc) + (oi.pendingProposal ? ' <span class="badge">先前已標：' + esc(oi.pendingProposal) + '</span>' : '') + '</div>'
        + '<div class="m">' + (daysAgo(oi.reportDate) ? '上次回報 ' + esc(daysAgo(oi.reportDate)) + '　' : '') + '區域：' + esc(oi.zoneName || '—') + '　狀態：' + esc(oi.effectiveStatus) + '</div>'
        + (oi.assignNote ? '<div class="assign">後台交辦：' + esc(oi.assignNote) + '</div>' : '')
        + '<div class="acts"><button data-p="' + i + '|已處理" class="' + (sel === '已處理' ? 'on' : '') + '">已處理</button><button data-p="' + i + '|狀況一樣" class="grey' + (sel === '狀況一樣' ? ' on' : '') + '">狀況一樣</button><button data-p="' + i + '|需要換植" class="terra' + (sel === '需要換植' ? ' on' : '') + '">需要換植</button></div>'
        + (hint ? '<div class="hint ok">' + esc(hint) + '</div>' : '')
        + (sel ? '<input type="text" style="width:100%;margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:14px" placeholder="備註（可空）" value="' + esc(A.proposals[oi.ref].note || '') + '" data-pn="' + i + '">' : '')
        + '</div>';
    }).join('') + '</div>';
    Array.prototype.forEach.call(w.querySelectorAll('[data-p]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-p').split('|'); setProposal(Number(a[0]), a[1]); }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-pn]'), function (inp) { inp.addEventListener('input', function () { var oi = A.openIssues[Number(inp.getAttribute('data-pn'))]; if (oi && A.proposals[oi.ref]) { A.proposals[oi.ref].note = inp.value; markDirty(); } }); });
  }
  function renderZones() {
    var w = $('zones'); if (!w) return;
    w.innerHTML = A.st.zones.map(function (z, i) {
      return '<div class="zone" data-zi="' + i + '"><div class="zone-head"><div class="zone-num">' + (i + 1) + '</div><input type="text" placeholder="區域名稱（例：陽台、入口）" value="' + esc(z.name) + '" data-zname="' + i + '"><button class="zone-del" data-zdel="' + i + '" title="刪除">×</button></div>'
        + photoBlock(i, 'before', '養護前', '重大問題才拍') + photoBlock(i, 'after', '養護後', '每區必拍')
        + '<textarea rows="2" placeholder="本區整體說明（例：陽台黃椰子修剪後狀況良好）" data-zcap="' + i + '" style="margin-top:8px">' + esc(z.caption) + '</textarea>'
        + '<div id="issues-' + i + '"></div>'
        + (A.pickerOpen === i ? '<div class="picker"><div class="note" style="margin-bottom:6px">點選異常類型</div><div class="chips">' + types().map(function (t) { return '<button type="button" class="chip-btn' + (t === '自訂' ? ' custom' : '') + '" data-addiss="' + i + '|' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>'
          : '<button type="button" class="btn secondary sm" data-pick="' + i + '" style="width:100%;margin-top:10px">＋ 新增異常追蹤</button>')
        + '</div>';
    }).join('');
    A.st.zones.forEach(function (z, i) { renderThumbs(i, 'before'); renderThumbs(i, 'after'); renderIssues(i); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-zname]'), function (inp) { inp.addEventListener('input', function () { A.st.zones[Number(inp.getAttribute('data-zname'))].name = inp.value; markDirty(); }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-zcap]'), function (inp) { inp.addEventListener('input', function () { A.st.zones[Number(inp.getAttribute('data-zcap'))].caption = inp.value; markDirty(); }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-zdel]'), function (b) { b.addEventListener('click', function () { var i = Number(b.getAttribute('data-zdel')); if (A.st.zones.length === 1) { alert('至少要有一個區域'); return; } if (!confirm('確定刪除這個區域？')) return; A.st.zones[i].pendingBefore.concat(A.st.zones[i].pendingAfter).forEach(function (p) { photoDel(p.id); }); A.st.zones.splice(i, 1); A.st.zones.forEach(function (zz, k) { zz.seq = k + 1; }); renderZones(); markDirty(); }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-file]'), function (inp) { inp.addEventListener('change', function (e) { var a = inp.getAttribute('data-file').split('|'); if (e.target.files && e.target.files.length) onPhotos(e.target.files, Number(a[0]), a[1]); e.target.value = ''; }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-pick]'), function (b) { b.addEventListener('click', function () { A.pickerOpen = Number(b.getAttribute('data-pick')); renderZones(); }); });
    Array.prototype.forEach.call(w.querySelectorAll('[data-addiss]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-addiss').split('|'); addIssue(Number(a[0]), a[1]); }); });
  }
  function photoBlock(i, ba, label, sub) {
    return '<div class="ph-lab"><span>' + label + ' <span style="opacity:.7">' + sub + '</span></span></div><div class="ph-btns"><label class="ph-btn cam">拍照<input type="file" accept="image/*" capture="environment" data-file="' + i + '|' + ba + '"></label><label class="ph-btn">從相簿選<input type="file" accept="image/*" multiple data-file="' + i + '|' + ba + '"></label></div><div class="thumbs" id="th-' + ba + '-' + i + '"></div>';
  }
  function renderThumbs(zi, ba) {
    var z = A.st.zones[zi], c = $('th-' + ba + '-' + zi); if (!z || !c) return;
    var up = ba === 'before' ? z.beforePhotos : z.afterPhotos, pd = ba === 'before' ? z.pendingBefore : z.pendingAfter;
    var h = up.map(function (u, k) { return '<div class="thumb"><img src="' + esc(u) + '" data-fb="1"><span class="st done">已傳</span><button class="del" data-del="' + zi + '|' + ba + '|uploaded|' + k + '">×</button></div>'; }).join('')
      + pd.map(function (p, k) { var lab = p.status === 'done' ? '已備份' : (p.status === 'failed' ? '失敗・點重傳' : '上傳中'); return '<div class="thumb"><img src="' + p.dataUri + '"><span class="st ' + (p.status === 'done' ? 'done' : (p.status === 'failed' ? 'fail' : '')) + '"' + (p.status === 'failed' ? ' data-retry="' + zi + '|' + ba + '|' + k + '"' : '') + '>' + lab + '</span><button class="del" data-del="' + zi + '|' + ba + '|pending|' + k + '">×</button></div>'; }).join('');
    c.innerHTML = h;
    Array.prototype.forEach.call(c.querySelectorAll('[data-del]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-del').split('|'); delPhoto(Number(a[0]), a[1], a[2], Number(a[3])); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-retry]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-retry').split('|'); var arr = a[1] === 'before' ? A.st.zones[Number(a[0])].pendingBefore : A.st.zones[Number(a[0])].pendingAfter; if (arr[Number(a[2])]) uploadOne(arr[Number(a[2])], Number(a[0]), a[1]); }); });
    Array.prototype.forEach.call(c.querySelectorAll('img[data-fb]'), function (img) { img.addEventListener('error', function () { fallbackImg(img); }); });
  }
  function fallbackImg(img) {
    if (img.dataset.fbDone) { img.style.display = 'none'; return; }
    img.dataset.fbDone = '1';
    var m = String(img.src).match(/[?&]id=([\w-]+)/) || String(img.src).match(/\/d\/([\w-]+)/);
    if (!m) { img.style.display = 'none'; return; }
    T.api('photoData', { fileId: m[1] }).then(function (r) { if (r && r.ok && r.dataUri) img.src = r.dataUri; else img.style.display = 'none'; }).catch(function () { img.style.display = 'none'; });
  }
  function renderIssues(zi) {
    var z = A.st.zones[zi], c = $('issues-' + zi); if (!z || !c) return;
    z.issues = z.issues.map(normIssue).filter(Boolean);
    c.innerHTML = z.issues.map(function (iss, k) {
      var merged = { before: mergedPhotos(z, 'before'), after: mergedPhotos(z, 'after') };
      var rep = iss.repPhoto && merged[iss.repPhoto.kind] ? merged[iss.repPhoto.kind][iss.repPhoto.idx] : null;
      var segStatus = '<div class="segsm">' + STATUSES.map(function (s) { return '<button type="button" data-iss="' + zi + '|' + k + '|status|' + s + '" class="' + (iss.status === s ? 'on' : '') + '">' + s + '</button>'; }).join('') + '</div>';
      var segSev = '<div class="segsm sev">' + SEVS.map(function (s) { var cls = s === '急' ? 'hi' : (s === '觀察' ? 'lo' : ''); return '<button type="button" data-iss="' + zi + '|' + k + '|severity|' + s + '" class="' + (iss.severity === s ? 'on ' + cls : '') + '">' + s + '</button>'; }).join('') + '</div>';
      var repHtml = rep ? '<div class="rep"><img src="' + rep.src + '"><button type="button" class="btn sm secondary" data-reppick="' + zi + '|' + k + '">更換照片</button><button type="button" class="btn sm secondary" data-repclear="' + zi + '|' + k + '">移除</button></div>'
        : '<div class="rep"><button type="button" class="btn sm secondary" data-reppick="' + zi + '|' + k + '" style="border-color:var(--amber);color:var(--amber)">＋ 這株的照片（必選）</button></div>';
      var pickerHtml = '';
      if (A.repPicker === zi + '|' + k) {
        var pk = function (kind, label) { var arr = merged[kind]; if (!arr.length) return ''; return '<div class="note" style="margin:6px 0 4px">' + label + '</div><div class="thumbs">' + arr.map(function (p, idx) { return '<div class="thumb' + (iss.repPhoto && iss.repPhoto.kind === kind && iss.repPhoto.idx === idx ? ' pick' : '') + '" data-repset="' + zi + '|' + k + '|' + kind + '|' + idx + '"><img src="' + p.src + '"></div>'; }).join('') + '</div>'; };
        pickerHtml = '<div class="picker">' + ((merged.before.length + merged.after.length) ? '<div class="note">從本次照片選一張代表照</div>' + pk('before', '養護前') + pk('after', '養護後') : '<div class="note">這區還沒有照片：先在上面拍一張。</div>') + '</div>';
      }
      return '<div class="iss"><div class="iss-head"><span class="badge">' + esc(iss.type) + '</span>' + (iss.continuedFrom ? '<span class="badge cont">延續自上次</span>' : '') + segSev + segStatus + '<button type="button" class="zone-del" data-issdel="' + zi + '|' + k + '">×</button></div>'
        + '<input type="text" list="plants" placeholder="是哪一種植物？（必填，例：龜背芋）" value="' + esc(iss.plant) + '" data-issin="' + zi + '|' + k + '|plant">'
        + (iss.type === '自訂' ? '<input type="text" placeholder="自訂異常描述（例：白粉病）" value="' + esc(iss.customDesc) + '" data-issin="' + zi + '|' + k + '|customDesc">' : '')
        + '<div class="pot"><span class="note">盆器 cm</span><input type="number" inputmode="numeric" placeholder="盆徑" value="' + esc(iss.potW) + '" data-issin="' + zi + '|' + k + '|potW"><span>×</span><input type="number" inputmode="numeric" placeholder="高" value="' + esc(iss.potH) + '" data-issin="' + zi + '|' + k + '|potH"></div>'
        + '<input type="text" placeholder="備註（選填，例：已現場施藥）" value="' + esc(iss.note) + '" data-issin="' + zi + '|' + k + '|note">'
        + repHtml + pickerHtml + '</div>';
    }).join('');
    Array.prototype.forEach.call(c.querySelectorAll('[data-iss]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-iss').split('|'); updIssue(Number(a[0]), Number(a[1]), a[2], a[3]); renderIssues(Number(a[0])); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-issin]'), function (inp) { inp.addEventListener('input', function () { var a = inp.getAttribute('data-issin').split('|'); updIssue(Number(a[0]), Number(a[1]), a[2], inp.value); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-issdel]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-issdel').split('|'); A.st.zones[Number(a[0])].issues.splice(Number(a[1]), 1); renderIssues(Number(a[0])); markDirty(); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-reppick]'), function (b) { b.addEventListener('click', function () { var key = b.getAttribute('data-reppick'); A.repPicker = A.repPicker === key ? null : key; renderIssues(zi); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-repclear]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-repclear').split('|'); A.st.zones[Number(a[0])].issues[Number(a[1])].repPhoto = null; renderIssues(zi); markDirty(); }); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-repset]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-repset').split('|'); A.st.zones[Number(a[0])].issues[Number(a[1])].repPhoto = { kind: a[2], idx: Number(a[3]) }; A.repPicker = null; renderIssues(zi); markDirty(); }); });
  }

  // ── 送出 ──
  function validate() {
    var st = A.st;
    if (!st.clientId) return '請選擇客戶';
    if (!st.reportDate) return '請填養護日期';
    if (!st.startTime || !st.endTime) return '請填服務時間';
    if (st.startTime >= st.endTime) return '結束時間必須晚於開始時間';
    var MULTI = /[、,，\/／]|以及|還有/;
    for (var zi = 0; zi < st.zones.length; zi++) {
      var z = st.zones[zi], zn = String(z.name || '').trim();
      if (zn && MULTI.test(zn)) return '區域「' + zn + '」看起來寫了不只一個位置。一個區域只填一個位置，多個位置請分開新增區域。';
      for (var k = 0; k < z.issues.length; k++) {
        var iss = z.issues[k];
        if (!String(iss.plant || '').trim()) return '「' + (zn || ('區域' + (zi + 1))) + '」的異常「' + (iss.type || '') + '」還沒填是哪一種植物。不確定正式名稱就寫看得懂的特徵。';
        if (!iss.repPhoto) return '「' + (zn || ('區域' + (zi + 1))) + '」的異常「' + (iss.desc || iss.type) + '」還沒選這株的照片。' + (iss.continuedFrom ? '延續的異常一定要拍這次的狀況。' : '每一筆異常都要有照片。');
      }
    }
    return '';
  }
  function submit() {
    if (A.submitting) return;
    var err = validate(); if (err) { alert(err); return; }
    if (!A.st.reportId) {
      A.submitting = true; render();
      T.api('reportFind', { clientId: A.st.clientId, date: A.st.reportDate }).then(function (r) {
        A.submitting = false;
        if (r && r.found) {
          $('dup-text').textContent = '「' + (r.clientName || '') + '」在 ' + A.st.reportDate + ' 已有一份報告（' + (r.empName || '') + '　' + (r.startTime || '') + '–' + (r.endTime || '') + '）。';
          $('dup').style.display = 'flex'; $('dup').dataset.rid = r.reportId;
        } else proceed();
      }).catch(function () { A.submitting = false; proceed(); });
      return;
    }
    proceed();
  }
  function proceed() {
    A.submitting = true; render();
    var photos = [];
    var zones = A.st.zones.map(function (z) {
      z.pendingBefore.forEach(function (p, i) { photos.push({ pid: p.id, zoneSeq: z.seq, ba: 'before', order: i, url: p.status === 'done' ? p.url : '' }); });
      z.pendingAfter.forEach(function (p, i) { photos.push({ pid: p.id, zoneSeq: z.seq, ba: 'after', order: i, url: p.status === 'done' ? p.url : '' }); });
      return { seq: z.seq, name: z.name, caption: z.caption, beforePhotos: z.beforePhotos.slice(), afterPhotos: z.afterPhotos.slice(), issues: z.issues.filter(function (x) { return x.desc; }) };
    });
    var proposals = Object.keys(A.proposals).map(function (ref) { return { ref: ref, proposalType: A.proposals[ref].proposalType, note: A.proposals[ref].note || '' }; });
    var payload = { reportId: A.st.reportId || '', clientId: A.st.clientId, clientName: A.st.clientName, reportDate: A.st.reportDate, startTime: A.st.startTime, endTime: A.st.endTime, tasks: A.st.tasks, notes: A.st.notes, zones: zones, issueProposals: proposals };
    var rec = { clientName: A.st.clientName || '報告', reportDate: A.st.reportDate, payload: payload, photos: photos, total: photos.length, done: photos.filter(function (p) { return p.url; }).length, status: 'pending', createdAt: Date.now() };
    queuePut(rec).then(function () {
      A.st = initial(); A.proposals = {}; A.editing = false; A.openIssuesLoadedFor = ''; A.dirty = false; A.draftStatus = '';
      clearSnapshot(); T.api('draftDelete');
      A.submitting = false; render();
      alert('已送出。照片還在傳的話會在背景完成，請先別關這個頁面。');
      processQueue();
    }).catch(function (e) { A.submitting = false; render(); alert('送出失敗：' + (e && e.message || e) + '\n資料還在草稿裡，稍後再試。'); });
  }
  var qRunning = false, qUploaded = false;
  function processQueue() {
    if (qRunning) return; qRunning = true;
    (async function () {
      try {
        while (true) {
          var all = await queueAll();
          var rec = all.filter(function (r) { return r.status === 'pending' || r.status === 'uploading'; }).sort(function (a, b) { return a.createdAt - b.createdAt; })[0];
          if (!rec) break;
          rec.status = 'uploading'; await queuePut(rec); renderQueueBar();
          var failed = false;
          var photosAll = await photoAll(); var pmap = {}; photosAll.forEach(function (p) { pmap[p.id] = p; });
          for (var i = 0; i < rec.photos.length; i++) {
            var ph = rec.photos[i]; if (ph.url) continue;
            var src = pmap[ph.pid];
            if (!src) { failed = true; break; }
            if (src.url) { ph.url = src.url; continue; }
            var url = null;
            for (var att = 0; att <= 2 && !url; att++) {
              try { var r = await T.api('photoUpload', { dataUri: src.dataUri, reportId: rec.payload.reportId || ('q-' + rec.id), clientName: rec.clientName, zoneSeq: ph.zoneSeq, beforeAfter: ph.ba }); if (r && r.ok) url = r.url; } catch (e) {}
              if (!url && att < 2) await new Promise(function (s) { setTimeout(s, 800 + att * 700); });
            }
            if (!url) { failed = true; break; }
            ph.url = url; rec.done = rec.photos.filter(function (p) { return p.url; }).length; await queuePut(rec); renderQueueBar();
          }
          if (failed) { rec.status = 'failed'; await queuePut(rec); renderQueueBar(); continue; }
          rec.photos.forEach(function (ph) { var z = rec.payload.zones.filter(function (zz) { return zz.seq === ph.zoneSeq; })[0]; if (!z) return; var key = ph.ba === 'before' ? 'beforePhotos' : 'afterPhotos'; z[key] = z[key] || []; z[key].push(ph.url); });
          var saved = false;
          try { var rs = await T.api('reportSave', { payloadJson: JSON.stringify(rec.payload) }); saved = !!(rs && rs.ok); if (!saved && rs && rs.error) console.log('reportSave', rs); } catch (e) {}
          if (saved) { qUploaded = true; await queueDel(rec.id); rec.photos.forEach(function (ph) { photoDel(ph.pid); }); if (A.view === 'list') { A.list = null; renderList(); } }
          else { rec.status = 'failed'; await queuePut(rec); }
          renderQueueBar();
        }
      } finally {
        qRunning = false;
        var left = await queueAll();
        if (!left.length && qUploaded) { qUploaded = false; flashDone(); } else renderQueueBar();
      }
    })();
  }
  function renderQueueBar() {
    var bar = $('qbar'); if (!bar) return;
    queueAll().then(function (all) {
      if (!all.length) { bar.innerHTML = ''; return; }
      var busy = all.filter(function (r) { return r.status === 'uploading' || r.status === 'pending'; }), failed = all.filter(function (r) { return r.status === 'failed'; });
      var head, cls = '';
      if (busy.length) { var left = all.reduce(function (s, r) { return s + Math.max(0, (r.total || 0) - (r.done || 0)); }, 0); head = '照片上傳中（剩 ' + left + ' 張）・請保持頁面開啟'; }
      else if (failed.length) { head = '有 ' + failed.length + ' 份還沒傳完，連上網路會自動續傳'; cls = 'fail'; }
      else { bar.innerHTML = ''; return; }
      bar.innerHTML = '<div class="qbar ' + cls + '"><div style="font-weight:600">' + head + '</div>' + all.filter(function (r) { return r.status !== 'done'; }).map(function (r) { return '<div>· ' + esc(r.clientName) + ' ' + esc(r.reportDate || '') + '　' + (r.status === 'uploading' ? '上傳中 ' + r.done + '/' + r.total : (r.status === 'failed' ? '未完成 ' + r.done + '/' + r.total + ' <a href="#" data-qretry="' + r.id + '" style="color:#fff;text-decoration:underline">重試</a>' : '排隊中')) + '</div>'; }).join('') + '</div>';
      Array.prototype.forEach.call(bar.querySelectorAll('[data-qretry]'), function (a) { a.addEventListener('click', function (e) { e.preventDefault(); var id = Number(a.getAttribute('data-qretry')); queueAll().then(function (all2) { var rec = all2.filter(function (r) { return r.id === id; })[0]; if (!rec) return; rec.status = 'pending'; queuePut(rec).then(function () { renderQueueBar(); processQueue(); }); }); }); });
    });
  }
  function flashDone() { var bar = $('qbar'); if (!bar) return; bar.innerHTML = '<div class="qbar ok"><div style="font-weight:600">全部照片已安全上傳、報告已送出</div></div>'; setTimeout(function () { queueAll().then(function (all) { if (!all.length && $('qbar')) $('qbar').innerHTML = ''; else renderQueueBar(); }); }, 4000); }
  function resumeQueue() {
    window.addEventListener('online', function () { queueAll().then(function (all) { Promise.all(all.filter(function (r) { return r.status === 'failed'; }).map(function (r) { r.status = 'pending'; return queuePut(r); })).then(function () { renderQueueBar(); processQueue(); }); }); });
    queueAll().then(function (all) { Promise.all(all.filter(function (r) { return r.status === 'uploading'; }).map(function (r) { r.status = 'pending'; return queuePut(r); })).then(function () { renderQueueBar(); processQueue(); }); });
  }

  // ── 我的報告 ──
  function renderList() {
    if (A.list === null) {
      $('app').innerHTML = '<div class="card"><div class="note">載入中…</div></div>';
      T.api('reportsMine', { limit: 100 }).then(function (r) { A.list = (r && r.ok && r.list) || []; if (A.view === 'list') renderList(); });
      return;
    }
    if (!A.list.length) { $('app').innerHTML = '<div class="card"><div class="note">還沒有報告紀錄。</div></div>'; return; }
    $('app').innerHTML = '<div class="card">' + A.list.map(function (r) { return '<div class="list-item" data-open="' + esc(r.reportId) + '"><div class="t">' + esc(r.clientName || '(未指定客戶)') + ' <span class="chip">' + esc(r.status || '') + '</span></div><div class="m">' + esc(r.reportDate) + '　' + esc(r.startTime || '') + '–' + esc(r.endTime || '') + (r.tasks ? '　' + esc(r.tasks) : '') + '</div></div>'; }).join('') + '</div><div class="note" style="text-align:center">點一筆可以修改後重新送出</div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (el) { el.addEventListener('click', function () { openReport(el.getAttribute('data-open')); }); });
  }
  function openReport(rid) {
    $('app').innerHTML = '<div class="card"><div class="note">載入報告…</div></div>';
    T.api('reportGet', { reportId: rid }).then(function (r) {
      if (!(r && r.ok)) { alert('載入失敗：' + ((r && (r.detail || r.error)) || '')); A.view = 'list'; render(); return; }
      var d = r.data;
      A.st = { reportId: d.reportId, clientId: d.clientId, clientName: d.clientName, reportDate: d.reportDate, startTime: d.startTime, endTime: d.endTime, timesFromCheckin: false, tasks: d.tasks || [], notes: d.notes || '',
        zones: (d.zones && d.zones.length ? d.zones : [{ seq: 1, name: '' }]).map(function (z) { return { seq: z.seq, name: z.name || '', caption: z.caption || '', beforePhotos: z.beforePhotos || [], afterPhotos: z.afterPhotos || [], pendingBefore: [], pendingAfter: [], issues: z.issues || [] }; }) };
      A.proposals = {}; A.editing = true; A.openIssuesLoadedFor = ''; A.view = 'form'; setSeg(); snapshot(); render();
    });
  }
  function setSeg() { $('seg-form').className = A.view === 'form' ? 'on' : ''; $('seg-list').className = A.view === 'list' ? 'on' : ''; }
  $('seg-form').addEventListener('click', function () { A.view = 'form'; setSeg(); render(); });
  $('seg-list').addEventListener('click', function () { A.view = 'list'; setSeg(); render(); });
  $('dup-cancel').addEventListener('click', function () { $('dup').style.display = 'none'; });
  $('dup-new').addEventListener('click', function () { $('dup').style.display = 'none'; proceed(); });
  $('dup-edit').addEventListener('click', function () { var rid = $('dup').dataset.rid; $('dup').style.display = 'none'; if (rid) openReport(rid); });
  $('pgv').textContent = T.CFG.version || ''; $('home-lnk').href = T.href('index.html');
  $('plants').innerHTML = PLANTS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');

  // 封閉測試掛鉤（?dev=1 才有）：從主控台塞照片／讀狀態
  if (T.qs.get('dev') === '1') window.__staffReport = { A: A, addDataUri: function (zi, ba, dataUri) { var z = A.st.zones[zi], key = ba === 'before' ? 'pendingBefore' : 'pendingAfter'; var ph = { id: uid(), dataUri: dataUri, status: 'uploading', url: '' }; z[key].push(ph); photoPut(ph); renderThumbs(zi, ba); markDirty(); uploadOne(ph, zi, ba); return ph.id; }, render: render, queueAll: queueAll, photoAll: photoAll };
  // ── 啟動 ──
  A.st = initial();
  T.init({ skipWhoami: true }).then(function () { return T.api('careInit'); }).then(function (r) {
    if (!(r && r.ok)) { T.showErr(T.errText(r)); return; }
    A.me = r; A.sites = r.sites || []; A.promoted = r.promotedTypes || [];
    var todayIds = {}; (r.items || []).forEach(function (it) { todayIds[it.siteCode] = 1; });
    A.sites.forEach(function (s) { s.today = !!todayIds[s.id]; });
    A.sites.sort(function (a, b) { return (b.today - a.today) || (b.assigned - a.assigned) || String(a.name).localeCompare(String(b.name)); });
    return restoreLocal().then(function (hadLocal) {
      if (!hadLocal) {
        A.st = initial();
        if (r.draft) A.serverDraft = r.draft;
        if (preClient && siteById(preClient)) { A.st.clientId = preClient; A.st.clientName = siteById(preClient).shortName || siteById(preClient).name; }
        else if ((r.items || []).length === 1 && siteById(r.items[0].siteCode)) { A.st.clientId = r.items[0].siteCode; A.st.clientName = siteById(A.st.clientId).shortName; }
      } else if (preClient && !A.st.clientId && siteById(preClient)) { A.st.clientId = preClient; A.st.clientName = siteById(preClient).shortName || ''; }
      render();
      if (hadLocal) uploadUnsent();
      resumeQueue();
    });
  }).catch(function (e) { console.log(e); });
})();
