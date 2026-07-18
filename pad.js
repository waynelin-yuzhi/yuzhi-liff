/* 植間共用簽名板 initYzPad(canvas) → { clear, hasInk, dataUrl }
   治本三件事：
   1. 版面未排完（offsetWidth=0）自動重試定尺寸——修「手怎麼簽都畫不出來」（慢手機實案）
   2. Pointer Events 優先（觸控/滑鼠/手寫筆同一條路）、舊機退回 touch/mouse
   3. 點一下也留點、清除＝重新配置畫布
   所有簽署頁（報價/勞報/點交/合約）一律用這顆；改這裡＝全站生效 */
function initYzPad(cv) {
  var st = { drew: false };
  var cx = cv.getContext('2d');
  function size() {
    var w = cv.offsetWidth, h = cv.offsetHeight;
    if (!w || !h) { setTimeout(size, 60); return; }
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.scale(dpr, dpr);
    cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.strokeStyle = '#1B1A17';
  }
  size();
  var drawing = false;
  function pos(e) {
    var r = cv.getBoundingClientRect();
    var p = (e.touches && e.touches[0]) || e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function down(e) {
    e.preventDefault();
    if (!cv.width) size();
    drawing = true;
    var p = pos(e);
    cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x + 0.1, p.y + 0.1); cx.stroke();
    st.drew = true;
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = pos(e);
    cx.lineTo(p.x, p.y); cx.stroke();
    st.drew = true;
  }
  function up() { drawing = false; }
  if (window.PointerEvent) {
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (e) { if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} } down(e); });
    cv.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  } else {
    cv.addEventListener('mousedown', down);
    cv.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, { passive: false });
    cv.addEventListener('touchmove', move, { passive: false });
    cv.addEventListener('touchend', up);
  }
  return {
    clear: function () { size(); st.drew = false; },
    hasInk: function () { return st.drew; },
    dataUrl: function () { return cv.toDataURL('image/png'); }
  };
}
