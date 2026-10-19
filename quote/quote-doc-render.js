// 由 yuzhiplant-system/quote-doc-render.gs 匯出（bin/export-quote-render.sh）；排版唯一來源仍是 GAS 那支，這裡不要手改
var Utilities = { formatDate: function (d, tz, fmt) { var p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
  var mm = String(p.month), dd = String(p.day);
  if (fmt === 'yyyy/M/d') return p.year + '/' + Number(mm) + '/' + Number(dd);
  if (fmt === 'yyyy-MM-dd') return p.year + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
  return p.year + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2) + ' ' + p.hour + ':' + p.minute; } };
var QUOTE_DEFAULT_STAMP_URI = '';
function _quoteDefaultStampDataUrl_() { return QUOTE_DEFAULT_STAMP_URI; }
/**
 * ============================================================
 * 報價單「客戶版文件」渲染器 —— 全鏈伺服器版的唯一排版來源
 * ------------------------------------------------------------
 * Wayne 2026-07-13 定案：客戶看單（quote-view）、線上簽回（quote-sign）、
 * 簽署合併後的 PDF，全部用這一支排版；編輯器 html2pdf 快照降為內部備存。
 * 設計語言（Wayne 指定）：現代日式簡約線條感——只有髮絲線、沒有色塊；
 * 墨色為主、苔綠只留公司名；小標籤灰字＋字距；價格不用彩色強調。
 * 純 JS（無 GAS API）→ 可在本地 node 驗排版；簽名合成＝opts.signature 傳入。
 * 分頁（2026-07-14）：換頁只准落在區塊之間——品項單列不拆、表頭跨頁重複、
 * 【備註＋簽署＋頁尾】綁一組；天地邊界放 @page（每頁生效、印刷分頁用），
 * 螢幕觀看用 @media screen 補回原紙感——兩個媒體各自成立、互不干擾。
 * ============================================================
 */

var QDOC_MODE_TITLES = {
  landscape: '景觀設計', subscription: '訂閱式養護', rental: '短期租賃', purchase: '單次採購'
};

function _qdocEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
  });
}
// 圖片來源只認 https 與 data:image（JSON 裡的品項照／章／簽名都是 data URI）；其他一律不畫、免得內容被塞進屬性
function _qdocImg_(u) {
  u = String(u || '');
  return /^(https:\/\/|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i.test(u) ? _qdocEsc_(u) : '';
}
function _qdocMoney_(n) {
  n = Math.round(Number(n) || 0);
  return 'NT$ ' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// data＝報價單工作檔 JSON（_collectProjectData 形狀）；opts={signature:{uri,name,at}?, watermark?}
function _quoteDocHtml_(data, opts) {
  data = data || {}; opts = opts || {};
  var esc = _qdocEsc_, money = _qdocMoney_;
  var mode = String(data.mode || 'purchase');
  var isStatement = String(data.docKind || 'quote') === 'statement';
  var docTitle = (QDOC_MODE_TITLES[mode] || '') + (isStatement ? '請款單' : '報價單');
  var cust = data.customer || {};
  // 效期一律換算成實際日期（呼叫端沒給就用 報價日+validityDays 自算）——避免小卡顯示日期、文件顯示天數
  if (!isStatement && !opts.validUntil && data.date && data.validityDays) {
    var _vd = new Date(String(data.date).replace(/\//g, '-') + 'T00:00:00+08:00');
    if (!isNaN(_vd.getTime())) {
      _vd.setDate(_vd.getDate() + Number(data.validityDays));
      opts.validUntil = Utilities.formatDate(_vd, 'Asia/Taipei', 'yyyy/M/d');
    }
  }
  var items = Array.isArray(data.items) ? data.items : [];
  var fees = Array.isArray(data.fees) ? data.fees : [];

  // ── 金額計算（與編輯器同律：items+fees=小計、5% 稅、grandTotal 以檔內為準） ──
  var subtotal = 0;
  items.forEach(function (it) { subtotal += Number(it.total != null ? it.total : (Number(it.qty) || 0) * (Number(it.price) || 0)) || 0; });
  fees.forEach(function (f) { subtotal += Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0; });
  // 押金＝保證金不課稅（訂閱 07-20、租賃 07-22 Wayne 拍板；與編輯器稅基同律）
  var docDepositSum = 0;
  if (mode === 'subscription' || mode === 'rental') {
    fees.forEach(function (f) {
      var _a = Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0;
      if (String(f.name || '').indexOf('押金') >= 0 && _a > 0) docDepositSum += _a;
    });
  }
  var taxableSub = subtotal - docDepositSum;
  var tax = data.isTaxEnabled ? Math.round(taxableSub * 0.05) : 0;
  var grand = Number(data.grandTotal) || (subtotal + tax);

  // ── 付款區（照抄編輯器各模式語意；landscape 才用 p1/p2、其餘模式 p1 無意義不得套用） ──
  var pt = data.paymentTerms || {};
  var p1 = Number(pt.p1) || 0, p2 = Number(pt.p2) || 0;
  var paySection = '';
  // 訂閱式：每月＝品項＋每月折扣（負項費用）；首期畸零 firstPeriod {from,to,days,monthDays,amount(含稅)}——起始日非 1 號時用、不再用負項費用硬湊
  var subItemsSum = items.reduce(function (s, it) { return s + (Number(it.total) || 0); }, 0);
  var subNegFees = fees.reduce(function (s, f) {
    var amt = Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0;
    return s + Math.min(0, amt);
  }, 0);
  var subMonthly = data.isTaxEnabled ? Math.round((subItemsSum + subNegFees) * 1.05) : (subItemsSum + subNegFees);
  var subFP = (mode === 'subscription' && data.firstPeriod && Number(data.firstPeriod.amount) > 0) ? data.firstPeriod : null;
  var subFPAmt = subFP ? Number(subFP.amount) || 0 : 0;
  var subOneTime = fees.reduce(function (s, f) {
    var amt = Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0;
    return s + ((amt > 0 && String(f.name || '').indexOf('押金') < 0) ? amt : 0);
  }, 0);
  function payLine(label, pct, amt) {
    return '<div class="row"><div class="n">' + label + '</div><div class="p">' + pct + '</div><div class="a">' + amt + '</div></div>';
  }
  function payNote(t) { return '<div class="pnote">' + t + '</div>'; }
  if (isStatement) {
    paySection = '<div class="pay-amt">本期請款總額　<b>' + money(grand) + '</b></div>';
  } else if (mode === 'landscape') {
    var p3 = Math.max(0, 100 - p1 - p2);
    var a1 = Math.round(grand * p1 / 100), a2 = Math.round(grand * p2 / 100);
    paySection = '<div class="pay">'
      + payLine('訂金／首期款', p1 + '%', money(a1))
      + payLine('進場款／中期款', p2 + '%', money(a2))
      + payLine('驗收款／尾款', p3 + '%', money(grand - a1 - a2))
      + '</div>';
  } else if (mode === 'subscription') {
    paySection = '<div class="pay-amt">次月起每月月費　<b style="color:#B85A3D">' + money(subMonthly) + '</b>'
      + '<span style="font-size:10px;color:#6B675E">　（' + (data.isTaxEnabled ? '含稅' : '未稅') + (subNegFees < 0 ? '、已含每月折扣' : '') + '）</span></div>'
      + (subFP ? '<div class="pay-amt">首期畸零期間 ' + esc(subFP.from || '') + '–' + esc(subFP.to || '') + '（' + Number(subFP.days || 0) + ' 天）　<b>' + money(subFPAmt) + '</b></div>' : '')
      + '<div class="pay-amt">首期應支付總計金額　<b>' + money(grand) + '</b></div>'
      + payNote(subFP
          ? '首期＝畸零期間養護費（每月月費 ÷ 當月天數 × 實際服務天數）＋押金及其他一次性費用；自次月起依上列月費按月收取。'
          : '首期支付金額包含當月養護費、押金及其他一次性費用；次月起依上列月費收取。');
  } else if (mode === 'rental') {
    paySection = '<div class="pay-amt">總計應支付款項　<b>' + money(grand) + '</b></div>'
      + payNote('租金與押金（詳見其他費用）須於出貨前結清。')
      + payNote('押金將於退租確認物品無損後退回。');
  } else {
    paySection = '<div class="pay">' + payLine('訂金／預付款', '100%', money(grand)) + '</div>'
      + payNote('單次採購專案，請於出貨前結清全額款項，以便安排後續備貨與物流作業。');
  }

  // ── 品項列（租賃模式帶天數/加日價欄、金額算式一眼可核；Wayne 2026-07-15） ──
  var isRental = (mode === 'rental');
  var rentalBase3 = isRental && data.rentalModel === 'base3';
  // 一式／檔期計價單（全品項 extraDay 明確為 0）：表頭不寫「/天」、天數欄改「租期(天)」——否則客戶拿單價×天數核不出金額（Q-2026-044）
  var rentalFlat = isRental && !rentalBase3 && items.length > 0 && items.every(function (it) { return it && it.extraDay != null && (Number(it.extraDay) || 0) === 0; });
  var rentalDaysN = Number(data.rentalDays || 1);
  var shareNext = items.map(function (it, i) { return !!(items[i + 1] && items[i + 1].sharePhotoWithPrev); });
  // 分區橫幅（Wayne 2026-07-27：客戶版也要看得出區域）：換區插一條全寬帶。
  // 用橫幅列不用 rowspan——GAS PDF 引擎跨頁會把 rowspan 儲存格切壞，橫幅列每列獨立、分頁安全。
  var areaBandOn = !isRental;
  var _prevArea = null;
  var itemRows = items.map(function (it, i) {
    var band = '';
    if (areaBandOn) {
      var a = String(it.area || '').trim();
      if (a && a !== _prevArea) band = '<tr class="area-band"><td colspan="5"><span class="ab">' + esc(a) + '</span></td></tr>';
      _prevArea = a || _prevArea;
    }
    var imgSrc = (it.image && !(it.sharePhotoWithPrev && i > 0)) ? _qdocImg_(it.image) : '';
    var img = imgSrc ? '<img class="ph" src="' + imgSrc + '">' : '';
    var specLine = [it.spec, (!areaBandOn && it.area) ? ('用途：' + it.area) : ''].filter(Boolean).map(esc).join('<br>');
    var cells;
    if (isRental) {
      cells = '<td class="c-qty">' + esc(it.qty || '') + '</td>'
        + '<td class="c-price">' + money(it.price) + '</td>'
        + (rentalBase3 ? '<td class="c-price">' + ((Number(it.extraDay) || 0) > 0 ? money(it.extraDay) : '—') + '</td>' : '')
        + '<td class="c-qty">' + rentalDaysN + '</td>'
        + '<td class="c-total">' + money(it.total != null ? it.total : 0) + '</td>';
    } else {
      cells = '<td class="c-qty">' + esc(it.qty || '') + ' ' + esc(it.unit || '') + '</td>'
        + '<td class="c-price">' + money(it.price) + '</td>'
        + '<td class="c-total">' + money(it.total != null ? it.total : (Number(it.qty) || 0) * (Number(it.price) || 0)) + '</td>';
    }
    var rowHtml = '<tr' + (shareNext[i] ? ' class="grp"' : '') + '>'
      + '<td class="c-no">' + (i + 1) + '</td>'
      + '<td class="c-item">' + img + '<div class="it-txt"><div class="it-name">' + esc(it.name || '') + '</div>'
      + (specLine ? '<div class="it-spec">' + specLine + '</div>' : '') + '</div></td>'
      + cells
      + '</tr>';
    // GAS PDF 引擎 CSS 層疊不可靠——共用組去分隔線用 inline style 硬蓋
    if (shareNext[i]) rowHtml = rowHtml.replace(/<td /g, '<td style="border-bottom:none" ');
    return band + rowHtml;
  }).join('');
  var feeRows = fees.map(function (f, i) {
    var amt = Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0;
    var feeCells;
    if (isRental) {
      feeCells = '<td class="c-qty">' + esc(f.qty || '1') + ' 式</td>'
        + '<td class="c-price">' + money(amt) + '</td>'
        + (rentalBase3 ? '<td class="c-price">—</td>' : '')
        + '<td class="c-qty">—</td>'
        + '<td class="c-total">' + money(amt) + '</td>';
    } else {
      feeCells = '<td class="c-qty">' + esc(f.qty || '1') + ' 式</td>'
        + '<td class="c-price">' + money(amt) + '</td>'
        + '<td class="c-total">' + money(amt) + '</td>';
    }
    return '<tr>'
      + '<td class="c-no">' + (items.length + i + 1) + '</td>'
      + '<td class="c-item"><div class="it-txt"><div class="it-name">' + esc(f.name || f.label || '其他費用')
      + (((mode === 'subscription' || mode === 'rental') && String(f.name || '').indexOf('押金') >= 0 && amt > 0)
          ? '<span style="display:inline-block;font-size:9.5px;color:#8a6a2e;border:1px solid #D8C08A;border-radius:4px;padding:0 5px;margin-left:6px;vertical-align:1px;">不計稅・退租退還</span>' : '')
      + '</div>'
      + (f.spec ? '<div class="it-spec">' + esc(f.spec) + '</div>' : '') + '</div></td>'
      + feeCells
      + '</tr>';
  }).join('');

  // ── 簽署區（簽名合成：客戶簽名圖＋植間章並排；未簽＝留線） ──
  var sig = opts.signature || null;
  // 公司章保底（Wayne 2026-07-28：給客戶的輸出一定要有章）：JSON 沒帶就拿系統預設章。
  // 這裡是所有客戶面（分享頁/PDF/簽回版）的唯一出口、在此保底＝不可能再漏
  var _stampUri = String(data.stampDataUrl || '');
  if (!_stampUri) {
    try { _stampUri = (typeof _quoteDefaultStampDataUrl_ === 'function') ? _quoteDefaultStampDataUrl_() : ''; } catch (e) { _stampUri = ''; }
  }
  var stampImg = _qdocImg_(_stampUri) ? '<img class="stamp" src="' + _qdocImg_(_stampUri) + '">' : '';
  var signBlock = '<div class="sign-row">'
    + '<div class="sign-cell"><div class="sign-label">植間設計股份有限公司</div>'
    +   '<div class="sign-line">' + stampImg + '</div>'
    +   '<div class="sign-meta">統一編號 90877240</div></div>'
    + '<div class="sign-cell"><div class="sign-label">客戶簽署' + (isStatement ? '（確認請款）' : '（確認同意本報價）') + '</div>'
    +   '<div class="sign-line">' + (sig && _qdocImg_(sig.uri) ? '<img class="sig-img" src="' + _qdocImg_(sig.uri) + '">' : '') + '</div>'
    +   '<div class="sign-meta">' + (sig ? esc(sig.name) + '　' + esc(sig.at) : '簽署人／日期') + '</div></div>'
    + '</div>';

  // ── 附件一・損壞買回價目表（租賃品項 ≥5 自動改附件整頁表格、兼撤場點交清點表；<5 維持備註一行） ──
  var bbAppendix = isRental && items.length > 0;   // Wayne 2026-07-16：不管幾項、租賃一律附價目表（兼點交清點表）
  var appendixHtml = '';
  if (bbAppendix) {
    var axSeen = {}, axRows = [], axNo = 0;
    items.forEach(function (it) {
      var key = (it.name || '') + '|' + (it.origPrice || 0);
      if (axSeen[key] !== undefined) { axRows[axSeen[key]].qty += (Number(it.qty) || 0); return; }
      axSeen[key] = axRows.length;
      axRows.push({ name: it.name || '', qty: Number(it.qty) || 0, orig: Number(it.origPrice) || 0 });
    });
    appendixHtml = '<div class="appx">'
      + '<div class="sec-label">附件一　APPENDIX I</div>'
      + '<div class="appx-title">損壞買回價目表（兼撤場點交清點表）</div>'
      + '<table class="items"><thead><tr>'
      + '<th class="c-no">NO.</th><th>品項名稱與規格</th><th class="c-qty">租借數量</th><th class="c-total">單件買回價（原價）</th>'
      + '</tr></thead><tbody>'
      + axRows.map(function (x) {
          axNo++;
          return '<tr><td class="c-no">' + axNo + '</td>'
            + '<td class="c-item"><div class="it-txt"><div class="it-name">' + esc(x.name) + '</div></div></td>'
            + '<td class="c-qty">' + x.qty + '</td>'
            + '<td class="c-total">' + (x.orig > 0 ? money(x.orig) : '依撤場點交現場議定') + '</td></tr>';
        }).join('')
      + '</tbody></table>'
      + '<ul class="notes" style="margin-top:10px;">'
      + '<li>本附件與報價單正文具同等效力；品項損壞以撤場點交當場雙方確認（照片為證）為準。</li>'
      + '<li>嚴重失去觀賞性之品項依上列買回價由客戶買回、品項歸客戶所有；買回款開立發票、如有收取押金得自押金優先扣抵。</li>'
      + '</ul></div>';
  }

  // ── 備註條件 ──
  var notes = [];
  if (!isStatement && opts.validUntil) notes.push('本報價單有效期限至 ' + String(opts.validUntil) + ' 止' + (opts.validUntilExtended ? '（經延長調整）' : (data.validityDays ? '（自報價日起 ' + Number(data.validityDays) + ' 日）' : '')) + '。');
  else if (!isStatement && data.validityDays) notes.push('本報價單自報價日起 ' + Number(data.validityDays) + ' 日內有效。');
  if (isStatement && data.payDueDays) notes.push('請於收到本請款單 ' + Number(data.payDueDays) + ' 日內完成付款。');
  if (mode === 'rental' && data.rentalDays) {
    notes.push('租賃期間：' + (data.rentalStart ? String(data.rentalStart).replace(/-/g, '/') + ' 〜 ' + String(data.rentalEnd || '').replace(/-/g, '/') + '、' : '') + '共 ' + Number(data.rentalDays) + ' 天；提前歸還恕不退費。');
    if (data.rentalModel === 'base3') notes.push('租金計價：基本租期 3 天（含）為一單位、自第 4 天起依各品項「加日價」按日累計。');
    notes.push('租借撤場：須按原本打包方式集中於卸／上貨區（自取請按原包裝包好）；追加商品另表估算。');
    notes.push('品項損壞以撤場點交當場雙方確認（照片為證）為準；如商品損壞嚴重失去觀賞性，依買回價（原價）由客戶買回、品項歸客戶所有（買回款開立發票；如有收取押金，得自押金優先扣抵）。');
    if (bbAppendix) {
      notes.push('損壞買回價：詳見「附件一・損壞買回價目表」（與本單具同等效力、並作為撤場點交清點依據）。');
    } else {
      var bbSeen = {}, bbParts = [], bbMissing = false;
      items.forEach(function (it) {
        if (Number(it.origPrice) > 0) {
          var bbKey = (it.name || '') + '|' + it.origPrice;
          if (!bbSeen[bbKey]) { bbSeen[bbKey] = 1; bbParts.push((it.name || '') + ' NT$ ' + Math.round(Number(it.origPrice)).toLocaleString()); }
        } else bbMissing = true;
      });
      if (bbParts.length) notes.push('損壞買回價參考（單件）：' + bbParts.join('／') + (bbMissing ? '；未列品項依撤場點交現場議定' : '') + '。');
    }
  }
  if (data.isTaxEnabled) notes.push('本單金額已含 5% 營業稅、開立統一發票。');
  // 自訂條款（服務範圍／不含項目／免責等；JSON extraNotes[]）——有帶就接在制式條款後；服務類單據可用 noPlantNote 關掉植栽照片那句
  if (Array.isArray(data.extraNotes)) data.extraNotes.forEach(function (n) { if (String(n || '').trim()) notes.push(String(n).trim()); });
  if (!data.noPlantNote) notes.push('植栽為自然產品、實際形態以現場交付為準；照片為主要樣式參考。');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(docTitle) + '</title><style>'
    + '@page { size: A4; margin: 18mm 0 14mm; }'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + 'body { font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; color: #26251F; background: #fff;'
    + '  -webkit-print-color-adjust: exact; font-size: 12px; line-height: 1.75; }'
    + '.paper { width: 210mm; box-sizing: border-box; margin: 0 auto; padding: 0 16mm; position: relative; background: #fff; }'
    + '.hd, .meta, .sums, .pay-sec, .tail { page-break-inside: avoid; break-inside: avoid; }'
    + 'table.items thead { display: table-header-group; }'
    + 'table.items tbody tr { page-break-inside: avoid; break-inside: avoid; }'
    + 'table.items tr.grp td { border-bottom: none; }'
    + '.sec-label { page-break-after: avoid; break-after: avoid; }'
    + '.hd { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 14px; border-bottom: 1.5px solid #26251F; }'
    + '.hd .co { font-size: 19px; letter-spacing: 0.18em; color: #5F6E58; font-weight: 600; }'
    + '.hd .co-en { font-size: 8.5px; letter-spacing: 0.34em; color: #A09A8C; margin-top: 3px; }'
    + '.hd .doc { text-align: right; }'
    + '.hd .doc-title { font-size: 15px; letter-spacing: 0.3em; font-weight: 500; }'
    + '.hd .doc-sub { font-size: 11px; color: #6B675E; margin-top: 3px; letter-spacing: 0.06em; }'
    + '.meta { display: flex; justify-content: space-between; gap: 28px; padding: 16px 0 14px; border-bottom: 0.5px solid #D8D3C6; }'
    + '.meta .col { flex: 1; }'
    + '.meta .row { display: flex; gap: 12px; padding: 2.5px 0; }'
    + '.meta .k { width: 52px; flex: none; font-size: 10px; letter-spacing: 0.22em; color: #A09A8C; padding-top: 2px; }'
    + '.meta .v { font-size: 12px; }'
    + '.meta .v.big { font-size: 13.5px; font-weight: 600; letter-spacing: 0.04em; }'
    + '.sec-label { font-size: 10px; letter-spacing: 0.3em; color: #A09A8C; margin: 22px 0 6px; }'
    + 'table.items { width: 100%; border-collapse: collapse; }'
    + 'table.items th { font-size: 10px; font-weight: 400; letter-spacing: 0.22em; color: #A09A8C; text-align: left;'
    + '  padding: 7px 6px; border-bottom: 1px solid #26251F; }'
    + 'table.items td { padding: 11px 6px; border-bottom: 0.5px solid #E2DDD0; vertical-align: top; }'
    + '.c-no { width: 26px; color: #A09A8C; font-size: 11px; padding-top: 13px; }'
    + '.area-band td { padding: 16px 6px 4px; border-bottom: none; page-break-after: avoid; }'
    + '.area-band .ab { display: inline-block; border-left: 2.5px solid #939D84; padding-left: 8px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.25em; color: #5F6E58; line-height: 1.2; }'
    + '.c-item { }'
    + '.c-item .ph { width: 58px; height: 58px; object-fit: cover; border-radius: 2px; float: left; margin-right: 12px; }'
    + '.it-name { font-size: 12.5px; font-weight: 500; letter-spacing: 0.03em; }'
    + '.it-spec { font-size: 10.5px; color: #6B675E; margin-top: 2px; line-height: 1.6; }'
    + '.c-qty { width: 64px; text-align: center; white-space: nowrap; }'
    + '.c-price { width: 86px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }'
    + '.c-total { width: 96px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }'
    + 'table.items th.c-qty { text-align: center; } table.items th.c-price, table.items th.c-total { text-align: right; }'
    + '.sums { display: flex; justify-content: flex-end; margin-top: 4px; }'
    + '.sums .box { width: 240px; }'
    + '.sums .row { display: flex; justify-content: space-between; padding: 5.5px 6px; font-size: 12px; }'
    + '.sums .row .k { color: #6B675E; letter-spacing: 0.14em; font-size: 10.5px; padding-top: 2px; }'
    + '.sums .grand { border-top: 1px solid #26251F; margin-top: 3px; padding-top: 8px; }'
    + '.sums .grand .k { color: #26251F; font-weight: 500; }'
    + '.sums .grand .v { font-size: 15.5px; font-weight: 600; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }'
    + '.pay .row { display: flex; gap: 12px; padding: 5px 0; border-bottom: 0.5px solid #E2DDD0; font-size: 11.5px; }'
    + '.pay .row .n { width: 110px; flex: none; }'
    + '.pay .row .p { width: 46px; flex: none; color: #6B675E; }'
    + '.pay .row .a { font-variant-numeric: tabular-nums; }'
    + '.pay-amt { font-size: 12.5px; padding: 6px 0 2px; letter-spacing: 0.04em; }'
    + '.pay-amt b { font-size: 14.5px; font-weight: 600; margin-left: 4px; font-variant-numeric: tabular-nums; }'
    + '.pnote { font-size: 10.5px; color: #6B675E; padding: 2px 0 2px 14px; position: relative; }'
    + '.pnote:before { content: "—"; position: absolute; left: 0; color: #C9C2B0; }'
    + '.bank { margin-top: 12px; border: 0.5px solid #C9C2B0; padding: 9px 14px; display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }'
    + '.bank .bk-label { font-size: 10px; letter-spacing: 0.28em; color: #A09A8C; flex: none; }'
    + '.bank .bk-txt { font-size: 11px; color: #26251F; }'
    + '.bank .bk-acct { font-size: 13.5px; font-weight: 600; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }'
    + '.bk-copy { display: none; }'
    + '@media screen { .bk-copy { display: inline-block; font-size: 10.5px; padding: 3px 12px; border: 1px solid #5F6E58; border-radius: 99px; background: none; color: #5F6E58; cursor: pointer; font-family: inherit; } }'
    + '.notes { margin-top: 6px; }'
    + '.notes li { font-size: 10.5px; color: #6B675E; list-style: none; padding: 2px 0 2px 14px; position: relative; }'
    + '.notes li:before { content: "—"; position: absolute; left: 0; color: #C9C2B0; }'
    + '.sign-row { display: flex; gap: 40px; margin-top: 34px; }'
    + '.appx { page-break-before: always; break-before: page; padding-top: 6px; }'
    + '@media screen { .appx { margin-top: 64px; padding-top: 30px; border-top: 1.5px solid #26251F; } }'
    + '.appx-title { font-size: 14px; font-weight: 600; letter-spacing: 0.12em; margin: 2px 0 12px; }'
    + '.sign-cell { flex: 1; }'
    + '.sign-label { font-size: 10px; letter-spacing: 0.24em; color: #A09A8C; margin-bottom: 6px; }'
    + '.sign-line { height: 86px; border-bottom: 1px solid #26251F; position: relative; display: flex; align-items: flex-end; }'
    + '.sign-line .stamp { height: 82px; margin-left: 14px; }'
    + '.sign-line .sig-img { height: 72px; margin-left: 14px; }'
    + '.sign-meta { font-size: 10px; color: #6B675E; margin-top: 5px; letter-spacing: 0.08em; }'
    + '.ft { margin-top: 56px; padding-top: 8px; border-top: 0.5px solid #D8D3C6;'
    + '  display: flex; justify-content: space-between; font-size: 8.5px; color: #A09A8C; letter-spacing: 0.12em; }'
    + '.th-sub { font-size: 8px; font-weight: 400; color: #9a917f; }'
    + '.tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }'
    + '@media screen and (max-width: 640px) { .paper { padding: 20px 14px !important; min-height: auto !important; } '
    +   '.tbl-wrap table { min-width: 560px; } .doc-title { font-size: 20px; } body { padding: 0 !important; } }'
    + '@media screen { .paper { min-height: 297mm; padding: 18mm 16mm 14mm; }'
    + '  .ft { position: absolute; left: 16mm; right: 16mm; bottom: 10mm; margin-top: 0; } }'
    + '</style></head><body><div class="paper">'
    + '<div class="hd"><div><div class="co">植間設計股份有限公司</div><div class="co-en">Jardin Design Studio CO., LTD.</div></div>'
    + '<div class="doc"><div class="doc-title">' + esc(docTitle) + '</div>'
    + (data.subtitle ? '<div class="doc-sub">' + esc(data.subtitle) + '</div>' : '') + '</div></div>'
    + '<div class="meta"><div class="col">'
    +   '<div class="row"><div class="k">致</div><div class="v big">' + esc(cust.name || '') + '</div></div>'
    +   (cust.vat ? '<div class="row"><div class="k">統一編號</div><div class="v">' + esc(cust.vat) + '</div></div>' : '')
    +   (cust.contact ? '<div class="row"><div class="k">聯絡人</div><div class="v">' + esc(cust.contact) + (cust.phone ? '　' + esc(cust.phone) : '') + '</div></div>' : '')
    +   (cust.address ? '<div class="row"><div class="k">地址</div><div class="v">' + esc(cust.address) + '</div></div>' : '')
    + '</div><div class="col" style="max-width:220px">'
    +   (data.quoteNo ? '<div class="row"><div class="k">報價編號</div><div class="v">' + esc(data.quoteNo) + '</div></div>' : '')
    +   '<div class="row"><div class="k">' + (isStatement ? '請款日期' : '報價日期') + '</div><div class="v">' + esc(data.date || '') + '</div></div>'
    +   (mode === 'rental' && (data.rentalStart || data.rentalDays) ?
          '<div class="row"><div class="k">租賃期間</div><div class="v">'
          + (data.rentalStart ? esc(String(data.rentalStart).replace(/-/g, '/')) + '〜' + esc(String(data.rentalEnd || '').replace(/-/g, '/')) + '<br>' : '')
          + '共 ' + Number(data.rentalDays || 1) + ' 天</div></div>' : '')
    +   (!isStatement && opts.validUntil ? '<div class="row"><div class="k">有效期限</div><div class="v">至 ' + esc(opts.validUntil) + '</div></div>'
        : (!isStatement && data.validityDays ? '<div class="row"><div class="k">有效期限</div><div class="v">' + Number(data.validityDays) + ' 日</div></div>' : ''))
    +   (isStatement && data.payDueDays ? '<div class="row"><div class="k">付款期限</div><div class="v">' + Number(data.payDueDays) + ' 日</div></div>' : '')
    + '</div></div>'
    + '<div class="sec-label">品項明細　ITEMS</div>'
    + '<div class="tbl-wrap"><table class="items"><thead><tr><th class="c-no">NO.</th><th>品項</th><th class="c-qty">數量</th>'
    + (isRental
        ? (rentalBase3 ? '<th class="c-price">基本租期價<br><span class="th-sub">（3 天內）</span></th><th class="c-price">加日價<br><span class="th-sub">（第 4 天起/天）</span></th>' : (rentalFlat ? '<th class="c-price">單價<br><span class="th-sub">（一式／檔期）</span></th>' : '<th class="c-price">單價/天</th>'))
          + '<th class="c-qty">' + (rentalFlat ? '租期(天)' : '天數') + '</th>'
        : '<th class="c-price">單價</th>')
    + '<th class="c-total">金額</th></tr></thead>'
    + '<tbody>' + itemRows + feeRows + '</tbody></table></div>'
    + '<div class="sums"><div class="box">'
    + (subFP
        ? '<div class="row"><div class="k">每月品項小計</div><div class="v">' + money(subItemsSum) + '</div></div>'
          + (subNegFees < 0 ? '<div class="row"><div class="k">每月折扣</div><div class="v">' + money(subNegFees) + '</div></div>' : '')
          + (data.isTaxEnabled ? '<div class="row"><div class="k">營業稅 5%</div><div class="v">' + money(subMonthly - subItemsSum - subNegFees) + '</div></div>' : '')
          + '<div class="row"><div class="k">每月月費（' + (data.isTaxEnabled ? '含稅' : '未稅') + '）</div><div class="v">' + money(subMonthly) + '</div></div>'
          + '<div class="row"><div class="k">首期畸零（' + Number(subFP.days || 0) + (subFP.monthDays ? '／' + Number(subFP.monthDays) : '') + ' 天）</div><div class="v">' + money(subFPAmt) + '</div></div>'
          + (subOneTime > 0 ? '<div class="row"><div class="k">一次性費用</div><div class="v">' + money(data.isTaxEnabled ? Math.round(subOneTime * 1.05) : subOneTime) + '</div></div>' : '')
          + (docDepositSum > 0 ? '<div class="row" style="color:#8a8275"><div class="k">＋押金（不計稅・退租退還）</div><div class="v">' + money(docDepositSum) + '</div></div>' : '')
          + '<div class="row grand"><div class="k">首期應付總計</div><div class="v">' + money(grand) + '</div></div>'
        : docDepositSum > 0
        ? '<div class="row"><div class="k">小計（應稅項目）</div><div class="v">' + money(taxableSub) + '</div></div>'
          + (data.isTaxEnabled
              ? '<div class="row"><div class="k">營業稅 5%</div><div class="v">' + money(tax) + '</div></div>'
                + '<div class="row"><div class="k">含稅合計</div><div class="v">' + money(taxableSub + tax) + '</div></div>'
              : '')
          + '<div class="row" style="color:#8a8275"><div class="k">＋押金（不計稅・退租退還）</div><div class="v">' + money(docDepositSum) + '</div></div>'
          + '<div class="row grand"><div class="k">應付總計</div><div class="v">' + money(grand) + '</div></div>'
        : '<div class="row"><div class="k">小計</div><div class="v">' + money(subtotal) + '</div></div>'
          + (data.isTaxEnabled ? '<div class="row"><div class="k">營業稅 5%</div><div class="v">' + money(tax) + '</div></div>' : '')
          + '<div class="row grand"><div class="k">' + (isStatement ? '應付總計' : '總計') + '</div><div class="v">' + money(grand) + '</div></div>')
    + '</div></div>'
    + '<div class="pay-sec"><div class="sec-label">付款方式　PAYMENT</div>'
    + paySection
    + '<div class="bank"><span class="bk-label">匯款帳戶</span>'
    + '<span class="bk-txt">國泰世華銀行（013）連城分行</span>'
    + '<span class="bk-acct" id="bkacct">128035009074</span>'
    + '<span class="bk-txt">戶名　植間設計股份有限公司</span></div>'
    + '</div>'
    + '<div class="tail"><div class="sec-label">備註　NOTES</div>'
    + '<ul class="notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
    + signBlock
    + '<div class="ft"><div>新北市中和區連城路569巷9弄26號1樓　02-2221-0318</div></div>'
    + '</div>'
    + appendixHtml
    // 舊「內嵌自縮」腳本已移除（2026-07-28）：它用 self!==top 判斷內嵌，但 GAS 網頁永遠住沙盒 iframe、
    // 判斷在一般分享頁恆成立 → 鎖捲動＋藏下載列（Wayne：預覽不能往下滑）。而簽核頁 srcdoc 是
    // sandbox="allow-same-origin"（不執行 script）、由外層自量高度——這段在唯一目標場景根本不會跑、純害無利。
    + '</div></body></html>';
}
