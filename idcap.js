/* idcap.js：身分證影本共用管線（paystub-view／labor-sign 共用）
   1. 即時相機：證件比例對位框，四邊對齊＋不反光＋清楚＋夠亮才轉綠，綠燈穩定約 1 秒自動拍
   2. 相簿照片：自動找證件四邊裁掉背景（找不到就請對方用相機框拍）
   3. 輸出：黑白影本＋淡浮水印＋紅色用途章，JPEG base64
   偵測只處理接近水平擺放的證件（對位框本來就要求平放），不做透視校正。 */
(function () {
  var CARD = 85.6 / 54;
  var RED = '#D9534F', GREEN = '#3FA34D';

  function toCanvas(src, maxSide) {
    var w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    var k = maxSide && Math.max(w, h) > maxSide ? maxSide / Math.max(w, h) : 1;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function grayOf(c) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, g = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.3 * d[j] + 0.59 * d[j + 1] + 0.11 * d[j + 2];
    return g;
  }

  function blur3(g, w, h) {
    var o = new Float32Array(g.length);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var s = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + x + dx];
      o[y * w + x] = s / 9;
    }
    return o;
  }

  /* 水平邊（上下緣）與垂直邊（左右緣）分開的邊緣強度圖 */
  function edgeMaps(g, w, h) {
    var H = new Float32Array(g.length), V = new Float32Array(g.length), all = [];
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
      var gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
      var ax = Math.abs(gx), ay = Math.abs(gy);
      if (ay > ax) H[i] = ay; else V[i] = ax;
      if ((x & 3) === 0 && (y & 3) === 0) all.push(ax + ay);
    }
    all.sort(function (a, b) { return a - b; });
    var p95 = all.length ? all[Math.floor(all.length * 0.95)] : 0;
    return { H: H, V: V, thr: Math.max(40, p95 * 0.35) };
  }

  function peaks(prof, minGap, k) {
    var c = [];
    for (var i = 2; i < prof.length - 2; i++) if (prof[i] >= prof[i - 1] && prof[i] >= prof[i + 1] && prof[i] > 0) c.push(i);
    c.sort(function (a, b) { return prof[b] - prof[a]; });
    var out = [];
    for (var j = 0; j < c.length && out.length < k; j++) {
      var ok = true;
      for (var q = 0; q < out.length; q++) if (Math.abs(out[q] - c[j]) < minGap) { ok = false; break; }
      if (ok) out.push(c[j]);
    }
    return out;
  }

  /* 一條邊上有多少比例的點真的有邊緣（容許 ±2px 偏移）：證件外框是連續長邊、字的邊緣是零碎的 */
  function coverH(M, w, h, y, x0, x1, thr) {
    var hit = 0, n = 0;
    for (var x = x0; x <= x1; x += 2) {
      n++;
      for (var dy = -2; dy <= 2; dy++) { var yy = y + dy; if (yy > 0 && yy < h && M[yy * w + x] > thr) { hit++; break; } }
    }
    return n ? hit / n : 0;
  }
  function coverV(M, w, h, x, y0, y1, thr) {
    var hit = 0, n = 0;
    for (var y = y0; y <= y1; y += 2) {
      n++;
      for (var dx = -2; dx <= 2; dx++) { var xx = x + dx; if (xx > 0 && xx < w && M[y * w + xx] > thr) { hit++; break; } }
    }
    return n ? hit / n : 0;
  }

  /* 找證件外框：回傳原圖座標 {x,y,w,h,score} 或 null。opt.minFrac＝證件最少要占畫面寬或高的比例 */
  function detect(src, opt) {
    opt = opt || {};
    var c = toCanvas(src, opt.work || 420), w = c.width, h = c.height;
    var g = blur3(grayOf(c), w, h), E = edgeMaps(g, w, h);
    var rowP = new Float32Array(h), colP = new Float32Array(w);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (E.H[i] > E.thr) rowP[y] += 1;
      if (E.V[i] > E.thr) colP[x] += 1;
    }
    var rows = peaks(rowP, Math.max(3, h * 0.03), 14), cols = peaks(colP, Math.max(3, w * 0.03), 14);
    var minF = opt.minFrac || 0.35, best = null;
    for (var a = 0; a < rows.length; a++) for (var b = 0; b < rows.length; b++) {
      var t = rows[a], bt = rows[b];
      if (bt - t < h * 0.12) continue;
      for (var l0 = 0; l0 < cols.length; l0++) for (var r0 = 0; r0 < cols.length; r0++) {
        var l = cols[l0], r = cols[r0];
        if (r - l < w * 0.12) continue;
        var cw = r - l, ch = bt - t;
        if (cw < w * minF && ch < h * minF) continue;
        var asp = cw / ch, e = Math.min(Math.abs(Math.log(asp / CARD)), Math.abs(Math.log(asp * CARD)));
        if (e > 0.2) continue;
        var cv = (coverH(E.H, w, h, t, l, r, E.thr) + coverH(E.H, w, h, bt, l, r, E.thr)
          + coverV(E.V, w, h, l, t, bt, E.thr) + coverV(E.V, w, h, r, t, bt, E.thr)) / 4;
        var score = cv * (1 - e) * Math.pow((cw * ch) / (w * h), 0.08);
        if (cv >= 0.5 && (!best || score > best.score)) best = { l: l, t: t, r: r, b: bt, score: score, cover: cv };
      }
    }
    if (!best) return null;
    var k = (src.videoWidth || src.naturalWidth || src.width) / w;
    var ins = 0.006;
    var bw = best.r - best.l, bh = best.b - best.t;
    return { x: (best.l + bw * ins) * k, y: (best.t + bh * ins) * k, w: bw * (1 - 2 * ins) * k, h: bh * (1 - 2 * ins) * k, score: best.score, cover: best.cover };
  }

  /* 畫面品質：反光比例、清晰度（拉普拉斯變異數）、平均亮度 */
  function quality(src) {
    var c = toCanvas(src, 320), w = c.width, h = c.height, g = grayOf(c), n = 0, hi = 0, sum = 0, ls = 0, ls2 = 0, m = 0;
    for (var y = 2; y < h - 2; y++) for (var x = 2; x < w - 2; x++) {
      var i = y * w + x, v = g[i];
      n++; sum += v; if (v > 248) hi++;
      var lap = 4 * v - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      ls += lap; ls2 += lap * lap; m++;
    }
    var mean = sum / n, lm = ls / m;
    return { glare: hi / n, sharp: ls2 / m - lm * lm, mean: mean };
  }
  function qualityMsg(q) {
    if (q.mean < 70) return '太暗了，請到亮一點的地方';
    if (q.glare > 0.012) return '有反光，請把證件拿出保護套或換個角度';
    if (q.sharp < 50) return '不夠清楚，請拿穩、等對焦';
    return '';
  }

  function crop(src, r) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w)); c.height = Math.max(1, Math.round(r.h));
    c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  /* 用途章：紅色雙框圓角章＋油墨不均的質感，乘法疊在影本上 */
  function stamp(ctx, W, H, year) {
    var sw = Math.round(Math.min(W, H * CARD) * 0.5), sh = Math.round(sw * 0.44);
    var s = document.createElement('canvas'); s.width = sw; s.height = sh;
    var x = s.getContext('2d'), col = '#B8322A';
    x.strokeStyle = col; x.fillStyle = col;
    function rr(p, lw, rad) {
      x.lineWidth = lw; x.beginPath();
      x.moveTo(p + rad, p); x.lineTo(sw - p - rad, p); x.quadraticCurveTo(sw - p, p, sw - p, p + rad);
      x.lineTo(sw - p, sh - p - rad); x.quadraticCurveTo(sw - p, sh - p, sw - p - rad, sh - p);
      x.lineTo(p + rad, sh - p); x.quadraticCurveTo(p, sh - p, p, sh - p - rad);
      x.lineTo(p, p + rad); x.quadraticCurveTo(p, p, p + rad, p); x.closePath(); x.stroke();
    }
    rr(sw * 0.02, sw * 0.03, sw * 0.05);
    rr(sw * 0.065, sw * 0.009, sw * 0.03);
    var serif = '"Noto Serif TC","Songti TC","PMingLiU","MingLiU",serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold ' + Math.round(sw * 0.052) + 'px ' + serif;
    x.fillText('植間設計股份有限公司', sw / 2, sh * 0.25);
    x.font = 'bold ' + Math.round(sw * 0.098) + 'px ' + serif;
    x.fillText('僅供報稅申報使用', sw / 2, sh * 0.52);
    x.font = 'bold ' + Math.round(sw * 0.05) + 'px ' + serif;
    x.fillText((year ? year + ' 年度' : '') + '｜他用無效', sw / 2, sh * 0.78);
    var id = x.getImageData(0, 0, sw, sh), d = id.data, seed = 20261010;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 3; i < d.length; i += 4) {
      if (!d[i]) continue;
      var f = 0.7 + 0.3 * rnd();
      if (rnd() < 0.07) f *= 0.25;
      d[i] = Math.round(d[i] * f);
    }
    x.putImageData(id, 0, 0);
    /* 放在中間偏左：避開身分證正面右側大頭照（紅墨疊在深色照片上會看不見） */
    ctx.save();
    ctx.translate(W * 0.44, H * 0.58);
    ctx.rotate(-0.14);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(s, -sw / 2, -sh / 2);
    ctx.restore();
  }

  /* 黑白影本＋淡浮水印＋用途章 → { b64, dataUrl } 或 { error } */
  function makeCopy(src, year, o) {
    o = o || {};
    var c = toCanvas(src, 1600), w = c.width, h = c.height, x = c.getContext('2d');
    var da = x.getImageData(0, 0, w, h), d = da.data, sum = 0;
    for (var i = 0; i < d.length; i += 4) {
      var g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      sum += g;
      if (!o.noTone) g = (g - 128) * 1.45 + 134;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    if (sum / (d.length / 4) < 42) return { error: '照片太暗，請在亮一點的地方重拍' };
    x.putImageData(da, 0, 0);
    if (!o.noTile) {
    x.save(); x.translate(w / 2, h / 2); x.rotate(-0.32);
    x.fillStyle = 'rgba(120,120,120,0.12)';
    x.font = 'bold ' + Math.round(w / 24) + 'px sans-serif';
    x.textAlign = 'center';
    var wm = '僅供' + (year ? ' ' + year + ' 年度' : '') + '報稅申報使用';
    for (var yy = -h; yy <= h; yy += Math.round(w / 5)) x.fillText(wm, 0, yy);
    x.restore();
    }
    stamp(x, w, h, year);
    var du = c.toDataURL('image/jpeg', 0.85);
    return { b64: du.slice(du.indexOf(',') + 1), dataUrl: du, w: w, h: h };
  }

  /* 相簿／系統相機的照片：先找證件裁掉背景，找不到就退回請對方用框拍 */
  function fromImage(img, opts) {
    var r = detect(img, { minFrac: 0.3 });
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, ar = iw / ih;
    var already = Math.min(Math.abs(Math.log(ar / CARD)), Math.abs(Math.log(ar * CARD))) < 0.12;
    if (!r && !already) return { error: '找不到證件邊緣，請把證件放在深色桌面上、四邊都入鏡後重拍' };
    /* 照片本身就是裁好的證件：邊緣貼著照片邊界，偵測到的常是卡片內的表格線（範圍偏小），直接用整張 */
    if (already && (!r || r.w * r.h < iw * ih * 0.75)) r = null;
    var cr = r ? crop(img, r) : toCanvas(img);
    if (Math.max(cr.width, cr.height) < 700) return { error: '證件在照片裡太小，請靠近一點重拍' };
    var res = makeCopy(cr, opts && opts.year, { noTone: !!(opts && opts.noTone), noTile: !!(opts && opts.noTile) });
    res.cropped = true;
    return res;
  }
  function fromFile(file, opts) {
    var img = new Image();
    img.onload = function () {
      var res;
      try { res = fromImage(img, opts); } catch (e) { res = { error: '照片處理失敗，請重拍' }; }
      URL.revokeObjectURL(img.src);
      if (res.error) { if (opts.onError) opts.onError(res.error); } else if (opts.onResult) opts.onResult(res);
    };
    img.onerror = function () { if (opts.onError) opts.onError('讀不到這張照片，請重拍'); };
    img.src = URL.createObjectURL(file);
  }

  /* ── 即時相機 ── */
  var UI = null;
  function buildUI() {
    if (UI) return UI;
    var st = document.createElement('style');
    st.textContent = '#yzcam{display:none;position:fixed;inset:0;background:#000;z-index:9998;font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif}'
      + '#yzcam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
      + '#yzwin{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);width:86vw;max-width:520px;aspect-ratio:1.585;border:3px solid ' + RED + ';border-radius:12px;box-shadow:0 0 0 200vmax rgba(0,0,0,.55);transition:border-color .15s}'
      + '#yztop{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top) + 18px);text-align:center;color:#fff;font-size:15px;line-height:1.6;padding:0 20px;text-shadow:0 1px 4px rgba(0,0,0,.7)}'
      + '#yzmsg{position:absolute;left:0;right:0;top:calc(42% + 30vw);margin-top:22px;text-align:center;font-size:16px;font-weight:700;color:#fff;padding:0 18px;text-shadow:0 1px 4px rgba(0,0,0,.7)}'
      + '#yzbar{position:absolute;left:0;right:0;bottom:0;padding:18px 22px calc(26px + env(safe-area-inset-bottom));display:flex;gap:12px}'
      + '#yzshoot{flex:1;padding:15px;background:#5F6E58;color:#fff;border:none;border-radius:10px;font-size:16.5px;font-weight:700}'
      + '#yzcancel{padding:15px 18px;background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:10px;font-size:14.5px}'
      + '#yzflash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .2s}';
    document.head.appendChild(st);
    var el = document.createElement('div'); el.id = 'yzcam';
    el.innerHTML = '<video playsinline muted autoplay></video><div id="yzwin"></div>'
      + '<div id="yztop">證件平放在深色桌面，四邊對齊框線<br>框變綠色會自動拍下</div><div id="yzmsg"></div>'
      + '<div id="yzbar"><button id="yzcancel" type="button">取消</button><button id="yzshoot" type="button">手動拍攝</button></div><div id="yzflash"></div>';
    document.body.appendChild(el);
    UI = { el: el, v: el.querySelector('video'), win: el.querySelector('#yzwin'), msg: el.querySelector('#yzmsg'), flash: el.querySelector('#yzflash') };
    el.querySelector('#yzcancel').addEventListener('click', function () { stop(); });
    el.querySelector('#yzshoot').addEventListener('click', function () { shoot(true); });
    return UI;
  }
  var S = null;
  function guideRect() {
    /* 對位框在原始影像像素上的位置（video 是 object-fit:cover） */
    var v = UI.v, vw = v.videoWidth, vh = v.videoHeight, ew = UI.el.clientWidth, eh = UI.el.clientHeight;
    var sc = Math.max(ew / vw, eh / vh), ox = (ew - vw * sc) / 2, oy = (eh - vh * sc) / 2;
    var b = UI.win.getBoundingClientRect();
    return { x: (b.left - ox) / sc, y: (b.top - oy) / sc, w: b.width / sc, h: b.height / sc };
  }
  function grab(r, m) {
    var v = UI.v, x0 = Math.max(0, r.x - r.w * m), y0 = Math.max(0, r.y - r.h * m);
    var x1 = Math.min(v.videoWidth, r.x + r.w * (1 + m)), y1 = Math.min(v.videoHeight, r.y + r.h * (1 + m));
    return { c: crop(v, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), ox: x0, oy: y0 };
  }
  function tick() {
    if (!S || !S.on) return;
    var v = UI.v;
    if (v.videoWidth && !S.busy) {
      var g = guideRect(), cap = grab(g, 0.12);
      var r = detect(cap.c, { work: 300, minFrac: 0.6 });
      var aligned = !!r && r.w * r.h > g.w * g.h * 0.72;
      var far = !aligned && !!detect(cap.c, { work: 300, minFrac: 0.2 });
      var q = quality(crop(cap.c, r || { x: cap.c.width * 0.1, y: cap.c.height * 0.1, w: cap.c.width * 0.8, h: cap.c.height * 0.8 }));
      var qm = qualityMsg(q);
      var good = aligned && !qm;
      UI.win.style.borderColor = good ? GREEN : RED;
      UI.msg.textContent = good ? '很好，保持不動…' : (!aligned ? (far ? '再靠近一點，讓證件填滿框' : '請把證件四邊對齊框線') : qm);
      S.okRun = good ? S.okRun + 1 : 0;
      if (S.okRun >= 5) { shoot(false); return; }
    }
    S.timer = setTimeout(tick, 180);
  }
  function shoot(manual) {
    if (!S || !S.on || !UI.v.videoWidth) return;
    S.busy = true;
    var g = guideRect(), cap = grab(g, 0.08);
    var r = detect(cap.c, { work: 520, minFrac: 0.55 });
    var card = r ? crop(cap.c, r) : crop(UI.v, g);
    UI.flash.style.opacity = '0.85'; setTimeout(function () { UI.flash.style.opacity = '0'; }, 120);
    var o = S.opts;
    stop();
    if (Math.max(card.width, card.height) < 500) { if (o.onError) o.onError('解析度不足，請靠近一點或改用系統相機拍'); return; }
    var res = makeCopy(card, o.year);
    res.cropped = !!r; res.manual = !!manual;
    if (res.error) { if (o.onError) o.onError(res.error); } else if (o.onResult) o.onResult(res);
  }
  function stop() {
    if (!S) return;
    S.on = false; clearTimeout(S.timer);
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    UI.v.srcObject = null; UI.el.style.display = 'none'; document.body.style.overflow = '';
    S = null;
  }
  /* 點格子：能開即時相機就開，不能（LINE 內建瀏覽器、權限被拒）就交給頁面的系統相機 input */
  function pick(side, opts) {
    var inLine = (navigator.userAgent || '').indexOf('Line/') >= 0;
    if (inLine || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (opts.fallback) opts.fallback(); return; }
    buildUI();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (stream) {
        S = { on: true, stream: stream, opts: opts, okRun: 0, busy: false, side: side };
        UI.v.srcObject = stream; UI.el.style.display = 'block'; document.body.style.overflow = 'hidden';
        UI.win.style.borderColor = RED; UI.msg.textContent = '請把證件四邊對齊框線';
        UI.v.onloadedmetadata = function () { S && (S.timer = setTimeout(tick, 400)); };
      })
      .catch(function () { if (opts.fallback) opts.fallback(); });
  }

  window.YzIdCap = { pick: pick, fromFile: fromFile, fromImage: fromImage, detect: detect, quality: quality, makeCopy: makeCopy, crop: crop };
})();
