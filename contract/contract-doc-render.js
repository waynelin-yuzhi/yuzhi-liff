// 由 yuzhiplant-system contract-backend.gs／contract-render-backend.gs 匯出（bin/export-contract-render.sh）；排版唯一來源仍是 GAS 那兩支，這裡不要手改
var Utilities = { formatDate: function (d, tz, fmt) { var p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  var mm = ('0' + p.month).slice(-2), dd = ('0' + p.day).slice(-2);
  if (fmt === 'yyyy-MM-dd') return p.year + '-' + mm + '-' + dd;
  return p.year + '-' + mm + '-' + dd + ' ' + p.hour + ':' + p.minute; } };
// 乙方合約章：GAS 讀 Drive；這裡由 pdf-worker 注入（data.stampUri）
var CONTRACT_STAMP_URI = '';
function _contractStampDataUri_() { return CONTRACT_STAMP_URI; }
// 附件一資料來源：GAS 讀 Drive 報價 JSON；這裡由注入的 CONTRACT_QUOTE_DOC = { quoteNo, date, doc } 供應
var CONTRACT_QUOTE_DOC = null;
function _qsignFindByQuoteNo_(quoteNo) {
  if (!CONTRACT_QUOTE_DOC || !CONTRACT_QUOTE_DOC.doc) return null;
  return { quoteNo: CONTRACT_QUOTE_DOC.quoteNo || quoteNo, date: CONTRACT_QUOTE_DOC.date || '', jsonId: 'injected' };
}
var DriveApp = { getFileById: function () { return { getBlob: function () { return { getDataAsString: function () { return JSON.stringify(CONTRACT_QUOTE_DOC.doc); } }; } }; } };
function _contractRocDate(s) {
  const m = String(s == null ? '' : s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return String(s == null ? '' : s);
  return (Number(m[1]) - 1911) + ' 年 ' + Number(m[2]) + ' 月 ' + Number(m[3]) + ' 日';
}

function _contractEsc_(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function _contractRenderHtml_(p, stampUri, opts) {
  opts = opts || {};   // { draft:bool 未定版預覽, finalNo:string 定版編號戳, signature:{uri,name,at} 甲方電子簽 }
  const E = _contractEsc_;
  const v = function(x) { return E(x == null ? '' : x); };
  const rd = function(x) { return E(_contractRocDate(x)); };
  const chap = function(label) {
    return '<table class="sec"><tr><td class="tk"><div></div></td><td class="lb">' + E(label) + '</td><td class="rl"><div></div></td></tr></table>';
  };
  const pp = function(t) { return '<p class="cp">' + t + '</p>'; };
  const ss = function(t) { return '<p class="cs">' + t + '</p>'; };

  let b = '';
  b += pp('甲方：' + v(p.客戶名稱));
  b += pp('乙方：植間設計股份有限公司');
  b += pp('為創造室內良好舒適的綠化環境，經甲乙雙方友好協商，就乙方提供甲方植物租賃及養護服務事宜，擬訂合約如下：');

  b += chap('壹、植栽養護服務範圍');
  b += pp('一、植栽設置地點：' + v(p.設置地點));
  b += pp('二、本合約服務期間內，由乙方提供之植栽產品皆應享有本合約所約定之保固服務及養護權益。');

  b += chap('貳、租期與續約');
  b += pp('一、租賃期間：本合約自 ' + rd(p.合約起日) + ' 起生效，至 ' + rd(p.合約迄日) + ' 止。（含首期畸零期間 ' + v(p.首期畸零期間) + '）');
  b += pp('二、續約條件：');
  b += ss('（1）本合約到期前 30 日內，任一方如不欲續約，應以書面通知對方；若未通知，合約將依原條件自動續約一年。');
  b += ss('（2）若任一方欲修改續約條件，亦應於合約期滿前 30 日內提出書面通知，雙方得就修改條件進行協商，協商成立後始依新條件續約；協商不成，則仍以原條件續約一年，除非任一方明確表示不再續約。');
  b += pp('三、評估期（軟退出窗）：');
  b += ss('（1）本合約自生效日起前三（3）個月為評估期。評估期內，乙方提供之養護服務內容、到場頻率及報告標準均與正式服務期相同，俾甲方完整評估服務效益。');
  b += ss('（2）評估期內，甲方仍應依約照常支付各期費用及押金，評估期非屬免費期間。');
  b += ss('（3）評估期內，甲方如決定不再續行本合約，得以書面通知乙方終止，並僅須支付撤場費用（植物回收、搬運、場地整理等，依乙方報價），毋庸支付伍、違約責任所定之違約金；乙方並應按比例退還甲方已預付而尚未施作之養護費用，惟進場佈建費用（如有）不予退還。');
  b += ss('（4）評估期屆滿後，本合約即進入正式服務期，並適用伍、違約責任之約定。');
  b += ss('（5）評估期就每一甲方、每一服務地點以一次為限，不重複適用。');
  b += pp('四、提前終止：');
  b += ss('（1）任一方欲終止合約，應於合約期滿前 30 日內以書面通知對方，並協調安排後續撤場事宜，否則視為同意續約。');
  b += ss('（2）除評估期（本條前項）外，任一方非經他方同意，不得於合約期間提前終止本合約；甲方於正式服務期內提前終止者，應依伍、違約責任第一項支付違約金及撤場費用。');
  b += ss('（3）若因可歸責於甲方之因素於合約到期前終止合約，甲方須支付乙方其撤場人力費用與運費等支出。如為乙方提前終止合約或甲方依伍、違約責任第二項終止合約者，則甲方毋庸支付前揭費用，且乙方應按比例退還尚未施作的費用。');

  b += chap('參、費用與付款方式');
  b += pp('一、費用標準：');
  b += ss('（1）本服務每月最低服務費用（低消）為新台幣陸仟元整（NT$6,000，未稅，營業稅另計）。甲方應配置達最低服務費用之植栽數量，始得使用本訂閱式養護服務。');
  b += ss('（2）首期畸零期間合計費用為新台幣 ' + v(p.首期畸零費用) + ' 元整（含稅）。');
  b += ss('（3）本合約之服務費用金額為每月新台幣 ' + v(p.月費) + ' 元整（含稅）。');
  b += ss('（4）付款方式為採用 ' + v(p.付款方式) + '：甲方每期支付新台幣 ' + v(p.期費) + ' 元整（含稅）。');
  b += pp('二、付款期限：乙方應於每月 20 日前開立發票並提供甲方，作為該月養護費用請款依據。甲方付款條件為月結 ' + v(p.月結天數) + ' 天，採 ' + v(p.付款制) + '（遇假日則順延至次一工作日）。');
  b += pp('三、逾期付款：');
  b += ss('（1）於約定付款日起，逾期付款超過 7 日，乙方有權暫停養護服務；逾期超過 30 日，乙方得終止合約，並適用「伍、違約責任」。');
  b += ss('（2）於約定付款日起，逾期付款超過 15 日，第 16 日起甲方須支付每日千分之三之滯納金，直至正常付款或合約終止日止。');
  b += ss('（3）如有額外產生更換植栽費用等，乙方應先行報價，經甲方同意後始得更換，更換費用應另行實報實銷。');
  b += ss('（4）合約期內，若甲方要求另行增加植物養護數量，乙方有權根據實際狀況報價並經甲方同意後，始得增加收費。');
  b += pp('四、押金約定：');
  b += ss('（1）為確保租用植栽及相關設備於合約終止時之完整歸還，甲方應於本合約生效時支付押金新台幣 ' + v(p.押金) + ' 元整（以下簡稱「押金」），乙方於收取後開立押金收據。');
  b += ss('（2）甲方終止本合約時，雙方應共同確認植栽、盆器及相關資材設備之狀況，若無毀損、遺失或其他可歸責於甲方之問題，則乙方應於合約終止日起算十五日內，將押金全數無息退還予甲方。');
  b += ss('（3）如經雙方確認，乙方提供之植栽、盆器或其他資材於解約時有毀損、遺失或嚴重不當使用致需修復或更換者，乙方得自押金中依損害情形酌予扣除，並開立明細說明。如押金不足以賠償者，甲方仍應負擔不足部分之賠償責任。');
  b += ss('（4）若甲方未經通知逕行終止合約或無預警搬遷，致使乙方無法回收植栽與資材者，乙方有權不予退還押金，並得請求額外之損害賠償。');
  b += ss('（5）合約期間甲方依「服務量調整」減量者，押金維持不變，乙方毋庸退還押金差額（押金係擔保現場植栽、盆器及設備之毀損遺失，與服務費用非等比例關係）。');
  b += ss('（6）合約期間甲方增量，致現場植栽及資材價值較原始增加達百分之三十（30%）以上者，乙方得通知甲方補繳相應之押金差額。');
  b += pp('五、服務量調整（減量與增量）：');
  b += ss('（1）調整時點：甲方得於（a）評估期屆滿時（即第三個月），及（b）其後每一合約年度期滿續約前，各商議調整一次。');
  b += ss('（2）減量下限：甲方減量後之每月服務費用，不得低於最低服務費用新台幣陸仟元整（NT$6,000，未稅）。');
  b += ss('（3）配置方式：減量或增量之植栽品項與配置，得由甲方依原配置等比調整，或由乙方就現場採光、空間條件及景觀整體性評估後建議調整品項；為維護整體設計效果與植栽健康，乙方就配置方式保留專業建議權。');
  b += ss('（4）增量：甲方得隨時提出增量需求，乙方依現場狀況報價，經甲方同意後施作。');
  b += ss('（5）運費：減量或增量之單次合理調整，其植栽搬運費用由乙方吸收，不另向甲方收取；惟甲方完全終止合約者，應依約支付撤場費用，且單次異常大幅變動（如一次撤回逾原始植栽數量半數）者，乙方得就搬運費用實報實銷。');
  b += ss('（6）調整生效後，本合約相關費用、押金及違約金之計算基礎，均以調整後之每月服務費用為準。');

  b += chap('肆、養護服務內容');
  ['甲方應使乙方人員得以於履行本合約義務內進出甲方之養護場所與正常供應水源，確保乙方可以進行養護服務。',
   '乙方應以善良管理人之注意義務，提供專業符合業界水準的養護服務，確保植物健康成長並維護環境整潔。',
   '若植物生病枯萎、不具備觀賞價值或不符合甲方需求者，乙方應承擔植物配送、搬運與更換的一切費用。',
   '根據甲方的環境、採光條件及植物生長特性，乙方應負責對植物進行合理的擺放和搭配，以確保植物的正常生長和環境的美觀協調。',
   '乙方應承擔養護植物用藥的費用，如植物因生病死亡與甲方無關。',
   '乙方應承擔定期對植物施肥、修剪與資材更換費用。',
   '如甲方不採取乙方之植物建議放置位置與照顧方式，導致植物因而生病、葉傷、落葉、缺水、爛根而枯萎或不具備觀賞性，則不在乙方承擔之責任範圍內。',
   '若出現植物與附著體（如盆器、水盤等），被人為損壞或非自然蟲害（如蟑螂、老鼠等）造成的損壞，如係可歸責於甲方或甲方之合作廠商，乙方得依附件一植栽明細表提出相關費用並與甲方協商同意後，由甲方支付費用；惟如係可歸責於乙方之因素所致者，不在此限。',
   '乙方應派專人每 7-10 天現場進行養護（包含但不限於澆水、落葉清理、修剪、追肥、蟲害預防等），如植栽無恙健康則無須更換，若有特殊需求（不包含植栽有健康狀況之情形）指定更換植栽時，植栽更換服務費另計。',
   '乙方應擔保其人員遵守甲方之要求及養護場所之規範。如有違反或因乙方人員操作不慎，導致乙方人員或第三人（包含甲方人員）發生任何意外或傷害，應由乙方負全責。若甲方因此需負擔賠償或補償責任，甲方並得向乙方請求賠償。如乙方人員因養護施作不慎，毀損甲方物件者，乙方亦應負連帶賠償責任。',
   '乙方應於每月提供一次上月之養護紀錄報告予甲方，原則上於次月月初提供，惟得視實際作業情況提前或順延，並以不影響甲方了解植栽狀況與服務成果為原則。'
  ].forEach(function(t, i) { b += pp((i + 1) + '、' + E(t)); });

  b += chap('伍、違約責任');
  b += pp('一、甲方提前終止或違約之責任：甲方於合約期間內提前終止本合約，或未依約支付費用且逾期達 30 日以上經乙方終止者，應依下列約定支付費用：');
  b += ss('（1）評估期（第一至第三個月）內終止本合約者，依貳、租期與續約之約定辦理，免付違約金；正式服務期內提前終止者，按終止時點支付違約金，其計算為剩餘租期之每月服務費用合計乘以下列比例，並另支付撤場費用：第四至第六個月為百分之五十（50%）、第七至第九個月為百分之三十（30%）、第十至第十二個月為百分之二十（20%）。如甲方曾依參、服務量調整變更服務量者，違約金及一切以服務費用為基礎之計算，均以調整後之每月服務費用為準。');
  b += ss('（2）續約年度（第十三個月起）之提前終止違約金，於續約後六個月內為剩餘租期之百分之三十（30%）、滿六個月以上為百分之二十（20%）；撤場費用均另計。');
  b += ss('（3）撤場費：甲方須支付植物回收、搬運、場地整理等相關撤場費用，費用依乙方報價為準。');
  b += pp('二、乙方違約責任：若乙方因可歸責之事由導致無法履行合約義務，甲方得以書面通知乙方限期改善，若乙方於收到通知後 15 個工作日內未能改善，則甲方得終止本合約，且乙方應按比例退還尚未施作的費用。');
  b += pp('三、養護期內，若一方違約或不履行本合約任一條款者，他方得以書面通知違約方限期改正，如逾期仍未改正，他方得終止本合約。如因此致他方受有損害者，他方並得請求違約方負損害賠償責任。');
  b += pp('四、若因不可抗力因素，如地震、水災、火災等不可預見、不可避免之情況，致使乙方無法提供養護服務，乙方應將甲方支付之費用按比例退還或雙方另行協議處理方式。');

  b += chap('陸、未盡事宜');
  ['本合約未盡事宜，雙方得以書面另行議定補充協議，補充協議於雙方簽署後，與本合約具有同等法律效力。',
   '如補充協議涉及調整服務範圍、費用或付款條件，應以雙方簽署之正式文件為準，電子郵件或口頭約定均不得作為正式變更依據。',
   '如雙方對未盡事宜存有爭議，應依本合約第捌條「爭議解決」條款處理，不得單方終止或擅自變更本合約。',
   '除經雙方事前書面同意外，任一方不得將本合約之權利或義務全部或部分轉讓予第三方。',
   '如因業務整併、合併或其他法定變更情形，任一方得將本合約權利與義務轉讓予其關係企業或繼受公司，惟應通知他方，並確保受讓方承擔本合約之所有權利與義務。'
  ].forEach(function(t, i) { b += pp((i + 1) + '、' + E(t)); });

  b += chap('柒、保密條款');
  b += pp('一、雙方應對於本合約履行過程中所知悉的以下資訊，負有嚴格保密義務，不得洩露、使用或提供予任何第三方：');
  b += ss('（1）技術資訊：包括但不限於植物養護技術、養護計畫、材料選擇標準等。');
  b += ss('（2）商業資訊：包括但不限於報價、客戶名單、合作夥伴等。');
  b += ss('（3）營運模式：包括但不限於乙方的訂閱式服務流程、管理方式、客製化服務方案等。');
  b += ss('（4）其他未經公開之機密資訊：如本合約內容、財務數據、策略規劃等。');
  b += pp('二、保密義務期限：本條款於合約期間內及合約終止後 3 年內持續有效。雙方不得在合約終止後，直接或間接利用對方機密資訊從事競業行為。例外情形：若因法院命令、政府機關要求或法律規定須揭露資訊時，應於揭露前以書面通知對方，並在合法範圍內盡可能減少揭露範圍。');
  b += pp('三、違反保密條款之責任：若任一方違反保密義務，應賠償因此造成的所有實際損害，並支付違約賠償金，其賠償金計算為本合約約定金額的兩倍；如洩密行為導致無法恢復之損害（如客戶流失、商譽損失），違約方應額外支付違約金，其違約金計算為本合約約定金額的五倍，作為懲罰性賠償。雙方有權採取法律行動，包括但不限於請求法院核發禁制令，以防止機密資訊進一步被濫用或洩漏。');

  b += chap('捌、爭議解決');
  b += pp('一、準據法：本合約之解釋及履行，悉依中華民國法令為準據法。');
  b += pp('二、協商機制：任何因本合約所生或與本合約有關之爭議，雙方應優先透過誠信協商解決，如 15 個工作日內未能達成共識，得進入仲裁或訴訟。');
  b += pp('三、仲裁與訴訟：協商不成時，雙方同意提交中華民國仲裁協會，依據中華民國仲裁法及該協會之仲裁規則，於台北市以仲裁方式解決。仲裁判斷為終局判決，雙方不得再行上訴，但若爭議涉及違約賠償、商業機密洩漏、重大財務損失或非貨幣性救濟（如禁制令），雙方得依中華民國法律向法院提起訴訟。');
  b += pp('四、仲裁費用：仲裁程序所產生之費用，包括但不限於仲裁庭費用、律師費、文件提交費用，應由敗訴方負擔。若仲裁結果為部分勝訴，則仲裁費用由仲裁庭裁定合理分配。');
  b += pp('五、管轄法院：除本條款另有規定之仲裁方式外，若雙方選擇訴訟解決爭議，雙方同意以台灣台北地方法院為第一審管轄法院。如雙方另行書面協議，得指定其他法院。');

  b += chap('玖、其他');
  b += pp('一、本合約倘有任何條款被法院判定為無效或得撤銷，不影響本合約其他條款之效力。');
  b += pp('二、本合約一式兩份，雙方各執一份，經雙方法定代表人或授權代表簽署後生效。');

  // 特約條款（選填）：客戶校對後雙方議定的增補／修改，逐條列出、效力優先於前列各條
  const _specialList = (function(x) {
    if (Array.isArray(x)) return x.map(function(s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
    return String(x == null ? '' : x).split(/[\n;；]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  })(p.特約條款);
  if (_specialList.length) {
    b += chap('特約條款');
    b += pp('經甲乙雙方協商議定下列特約條款，如與本合約其他條款牴觸，以特約條款為準：');
    const _cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    _specialList.forEach(function(t, i) { b += pp((_cn[i] || (i + 1)) + '、' + E(t)); });
  }

  const stampHtml = stampUri ? '<img class="stamp" src="' + stampUri + '" alt="合約專用章">' : '';
  // 中華民國日期：簽訂日期有值則帶入、否則留空格供現場手填（參逸琳外包合約樣式）
  const rocLine = (function() {
    const m = String(p.簽訂日期 == null ? '' : p.簽訂日期).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return '中華民國　' + (Number(m[1]) - 1911) + '　年　' + Number(m[2]) + '　月　' + Number(m[3]) + '　日';
    return '中華民國　＿＿＿　年　＿＿　月　＿＿　日';
  })();
  // 甲方電子簽（零登入簽收頁送回）→ 簽名圖＋簽署紀錄合成進簽名欄
  const eSig = opts.signature || null;
  const partyASigBlock = eSig && eSig.uri
    ? '<div class="sp"><img class="stamp" src="' + eSig.uri + '" alt="甲方簽名"></div>'
      + '<div class="esign-note">電子簽署：' + E(eSig.name || '') + '　' + E(eSig.at || '') + '</div>'
    : '<div class="sp"></div>';
  const sig = '<div class="sigwrap"><table class="sig"><tr>'
    + '<td class="sc">'
    +   '<div class="st">甲方（委託人）　簽署</div>'
    +   '<div class="sn">客戶名稱：' + v(p.客戶名稱) + '<br>統一編號：' + v(p.甲方統編) + '<br>代表人：' + v(p.甲方代表人) + '<br>聯絡地址：' + v(p.甲方地址) + '<br>聯絡電話：' + v(p.甲方電話) + '</div>'
    +   '<div class="sgp">簽名 / 蓋章：' + (eSig ? '（已電子簽署）' : '（請親簽並用印）') + '</div>'
    +   partyASigBlock
    + '</td>'
    + '<td class="sc">'
    +   '<div class="st">乙方（服務方）　簽署</div>'
    +   '<div class="sn">植間設計股份有限公司<br>統一編號：90877240<br>代表人：林瑋恒　<span class="seal">（合約專用章）</span><br>聯絡地址：新北市中和區連城路569巷9弄26號1樓<br>聯絡電話：02-2221-0318</div>'
    +   '<div class="sgp">簽名 / 蓋章：（請親簽並用印）</div>'
    +   '<div class="sp">' + stampHtml + '</div>'
    + '</td>'
    + '</tr></table>'
    + '<p class="rocdate">' + rocLine + '</p></div>';

  // 封面簽訂日期：有值走 rd() 轉民國格式；空值 fallback 手填佔位（比照簽章欄 rocLine 的設計），
  // 避免前端漏檢／舊呼叫路徑略過必填時，封面直接印出空白格。
  const coverSignDate = p.簽訂日期 ? rd(p.簽訂日期) : '中華民國　　年　　月　　日';
  // 版本戳：未定版預覽（琥珀 badge）／正式定版（含編號、產生時間）
  const versionStamp = opts.draft
    ? '<div class="draftmark">未定版預覽　·　僅供確認內容、不可簽署</div>'
    : (opts.finalNo
        ? '<div class="finalmark">正式定版　·　' + E(opts.finalNo) + '　·　' + E(opts.stampAt || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')) + ' 產生</div>'
        : '');
  const cover = '<div class="cover">'
    + '<div class="ck">YUZHIPLANT　·　植間設計</div>'
    + '<div class="ttl">訂閱式植栽與養護契約書</div>'
    + '<div class="cvrule"></div>'
    + '<table class="cinfo">'
    +   '<tr><td class="k">客戶名稱</td><td class="vv">' + v(p.客戶名稱) + '</td></tr>'
    +   '<tr><td class="k">簽訂日期</td><td class="vv">' + coverSignDate + '</td></tr>'
    +   '<tr><td class="k">合約編號</td><td class="vv">' + v(p.合約編號) + '</td></tr>'
    + '</table>'
    + '<div class="cver">2026-07 修訂版（評估期／低消／服務量調整／違約金級距）</div>'
    + versionStamp
    + '</div>';   // named page（coverpg→預設）切換自帶分頁；再放 page-break div 會夾出整張空白頁（2026-08-28 實案）

  // 附件一＝報價單品項明細（合約帶 報價單號 才有；訂閱式只簽合約、報價當附件——Wayne 2026-08-17）
  let appendix = '';
  if (String(p.報價單號 || '').trim()) {
    try { appendix = _contractQuoteAppendixHtml_(p); } catch (e) { appendix = ''; }
  }

  return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>'
    + (opts.draft ? '【未定版預覽】' : '') + v(p.客戶名稱) + ' 訂閱式養護合約</title><style>' + _contractCss_() + '</style></head><body>'
    + cover
    + '<div class="doc"><h1 class="h1">訂閱式植栽與養護合約</h1>' + b + sig + '</div>'
    + appendix
    + '<div style="margin:26px auto 12px;text-align:center;font-size:10.5px;color:#A09A8C;line-height:1.8;">此頁面由植間設計 Workspace 系統發出<br>植間設計股份有限公司｜統編 90877240</div>' + '</body></html>';
}

function _contractCss_() {
  return ''
    // 每頁頁尾頁碼（Wayne 2026-08-28；引擎實測支援 @page margin box＋counter、care-pdf 舊註記過時）
    // 封面慣例不顯示頁碼（計入不顯示；named page 讓封面走無頁尾樣式）
    + '@page { @bottom-center { content: "第 " counter(page) " 頁　·　共 " counter(pages) " 頁"; font-family:sans-serif; font-size:8.5pt; color:#a09a8c; } }'
    + '@page coverpg { @bottom-center { content: none; } }'
    + '.cover{page:coverpg;}'
    + 'html,body{margin:0;padding:0;}'
    + 'body{background:#ffffff;color:#2d342a;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC","Heiti TC",sans-serif;font-size:11pt;line-height:1.7;}'
    + '.cover{padding:62mm 22mm 0;text-align:center;}'
    + '.cover .ck{font-size:9.5pt;letter-spacing:3pt;color:#8c8c84;}'
    + '.cover .ttl{font-size:27pt;font-weight:normal;letter-spacing:6pt;color:#1f2620;padding-top:10mm;line-height:1.35;}'   // 26pt bold 在 GAS PDF 引擎無中文粗體字重、合成描邊糊字（2026-08-27 絢承封面實案）；大字級用 normal＋字距撐分量
    + '.cover .cvrule{width:40mm;height:0.5mm;background:#5f6e58;margin:12mm auto;}'
    + '.cover .cinfo{margin:0 auto;border-collapse:collapse;}'
    + '.cover .cinfo td{padding:2.5mm 0;font-size:11.5pt;vertical-align:top;}'
    + '.cover .cinfo .k{color:#8c8c84;letter-spacing:1.5pt;padding-right:8mm;text-align:right;white-space:nowrap;}'
    + '.cover .cinfo .vv{color:#2d342a;text-align:left;letter-spacing:0.3pt;}'
    + '.cover .cver{margin-top:26mm;font-size:8.5pt;color:#b6b6ad;letter-spacing:0.5pt;}'
    + '.doc{padding:16mm 18mm;}'
    + '.h1{text-align:center;font-size:17pt;font-weight:normal;letter-spacing:3pt;color:#1f2620;margin:0 0 8mm;}'
    + '.sec{width:100%;border-collapse:collapse;margin:7mm 0 3mm;}'
    + '.sec td{vertical-align:middle;}'
    + '.sec .tk{width:6mm;}'
    + '.sec .tk div{width:5mm;height:0.6mm;background:#5f6e58;}'
    + '.sec .lb{white-space:nowrap;font-size:12.5pt;font-weight:normal;letter-spacing:2pt;color:#3e4a38;padding:0 5mm 0 3mm;}'
    + '.sec .rl{width:100%;}'
    + '.sec .rl div{height:0.3mm;background:#e4e4dd;font-size:0;line-height:0;}'
    + '.cp{margin:1.5mm 0;font-size:11pt;color:#2d342a;}'
    + '.cs{margin:1mm 0 1mm 7mm;font-size:11pt;color:#2d342a;}'
    + '.sigwrap{page-break-inside:avoid;}'  // 簽名表＋民國日期行永遠同頁（防日期行孤兒跨頁）
    + '.sig{width:100%;border-collapse:collapse;margin-top:9mm;page-break-inside:avoid;}'
    + '.sig td.sc{width:50%;border:0.4mm solid #e7e8e0;background:#fafbf8;padding:6mm 6mm 5mm;vertical-align:top;color:#2d342a;}'
    + '.sig .st{font-size:11.5pt;font-weight:normal;letter-spacing:2.5pt;color:#3e4a38;margin-bottom:3mm;padding-bottom:2mm;border-bottom:0.3mm solid #e4e4dd;}'
    + '.sig .sn{font-size:10pt;line-height:1.95;color:#2d342a;}'
    + '.sig .seal{font-size:8.5pt;color:#8c8c84;letter-spacing:0.5pt;}'
    + '.sig .sgp{font-size:9.5pt;color:#8c8c84;margin-top:4mm;letter-spacing:0.5pt;}'
    + '.sig .sp{height:34mm;text-align:center;font-size:0;}'
    + '.sig .sp .stamp{max-width:34mm;max-height:34mm;margin-top:3mm;}'
    + '.rocdate{text-align:center;font-size:11pt;letter-spacing:1.5pt;color:#2d342a;margin-top:9mm;}'
    + '.draftmark{margin:14mm auto 0;display:inline-block;border:0.6mm solid #b8893e;color:#8a5a00;background:#fbf3e4;font-size:11pt;letter-spacing:2pt;padding:3mm 8mm;}'
    + '.finalmark{margin-top:14mm;font-size:8.5pt;color:#5f6e58;letter-spacing:1pt;}'
    + '.esign-note{font-size:8.5pt;color:#5f6e58;text-align:center;letter-spacing:0.5pt;margin-top:1mm;}'
    // 附件一（報價明細表）
    + '.axwrap{page-break-before:always;padding-top:12mm;}'
    + '.axwrap .sec{margin:0 0 3mm;}'
    + '.axmeta{font-size:9pt;color:#8c8c84;margin:0 0 3mm;letter-spacing:0.5pt;}'
    + '.ax{width:100%;border-collapse:collapse;font-size:9.5pt;table-layout:fixed;line-height:1.45;}'
    + '.ax thead{display:table-header-group;}'
    + '.ax th{background:#eef0e9;border:0.3mm solid #dcdcd4;padding:1.4mm 2.2mm;font-size:9pt;font-weight:normal;color:#3e4a38;text-align:left;letter-spacing:0.8pt;}'
    + '.ax td{border:0.3mm solid #dcdcd4;padding:1.2mm 2.2mm;vertical-align:top;color:#2d342a;}'
    + '.ax tr{page-break-inside:avoid;}'
    + '.ax .r{text-align:right;white-space:nowrap;}.ax .c{text-align:center;}'
    + '.ax .spec{font-size:8.5pt;color:#6b6b63;margin-left:1.5mm;}'
    + '.ax td.area{background:#f3f4ef;font-weight:normal;color:#3e4a38;letter-spacing:1.2pt;padding:0.9mm 2.2mm;font-size:9pt;}'
    + '.axsum{width:100%;border-collapse:collapse;margin-top:3mm;page-break-inside:avoid;}'
    + '.axsum td{padding:0.9mm 2.5mm;font-size:9.5pt;color:#2d342a;}'
    + '.axsum td.k{color:#5f6e58;letter-spacing:0.5pt;}.axsum td.v{text-align:right;white-space:nowrap;}'
    + '.axsum tr.grand td{border-top:0.4mm solid #2d342a;font-weight:normal;font-size:11pt;color:#1f2620;padding-top:2mm;}'
    + '.axnote{font-size:8.5pt;color:#6b6b63;line-height:1.55;margin-top:3mm;}'
    + '';
}

function qdocCreditsOf_(data) {
  data = data || {};
  if (String(data.mode || '') !== 'subscription' || String(data.docKind || '') === 'statement') return { list: [], total: 0 };   // 請款單不扣（只扣首期報價一次）
  var list = (Array.isArray(data.credits) ? data.credits : []).map(function (c) {
    return { name: String((c && c.name) || '首期折抵').substring(0, 60), amount: Math.round(Number(c && c.amount) || 0) };
  }).filter(function (c) { return c.amount > 0; });
  return { list: list, total: list.reduce(function (t, c) { return t + c.amount; }, 0) };
}

function _contractQuoteAppendixHtml_(p) {
  const rec = _qsignFindByQuoteNo_(String(p.報價單號 || ''));
  if (!rec || !rec.jsonId) return '';
  const d = JSON.parse(DriveApp.getFileById(rec.jsonId).getBlob().getDataAsString('UTF-8'));
  const E = _contractEsc_;
  const money = function(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '−NT$ ' : 'NT$ ') + Math.abs(n).toLocaleString(); };
  const items = Array.isArray(d.items) ? d.items : [];
  const fees = Array.isArray(d.fees) ? d.fees : [];
  const feeAmt = function(f) { return Number(f.total != null ? f.total : (f.amount != null ? f.amount : f.price)) || 0; };
  const taxOn = !!d.isTaxEnabled;
  let itemsSum = 0, negFees = 0, deposit = 0, oneTime = 0;
  items.forEach(function(it) { itemsSum += Number(it.total != null ? it.total : (Number(it.qty) || 0) * (Number(it.price) || 0)) || 0; });
  fees.forEach(function(f) {
    const a = feeAmt(f);
    if (a < 0) negFees += a;
    else if (String(f.name || '').indexOf('押金') >= 0) deposit += a;
    else oneTime += a;
  });
  const monthlyNet = itemsSum + negFees;
  const monthly = taxOn ? Math.round(monthlyNet * 1.05) : monthlyNet;
  const oneTimeTax = taxOn ? Math.round(oneTime * 1.05) : oneTime;
  const fp = d.firstPeriod || null;
  const fpAmt = fp ? (Number(fp.amount) || 0) : 0;
  const grand = Number(d.grandTotal) || (fp ? fpAmt + deposit + oneTimeTax : monthly + deposit + oneTimeTax);
  const credits = qdocCreditsOf_(d);
  // 月費與一次性各自四捨五入可能與 grand（合併算稅）差 1 元：差額併入一次性費用顯示列、使逐列加總等於合計
  const oneShow = (function() { const df = grand - ((fp ? fpAmt : monthly) + deposit + oneTimeTax); return (oneTime > 0 && Math.abs(df) <= 1) ? oneTimeTax + df : oneTimeTax; })();

  let rows = '', lastArea = null, no = 0;
  items.forEach(function(it) {
    const area = String(it.area || '').trim();
    if (area && area !== lastArea) { rows += '<tr><td class="area" colspan="6">' + E(area) + '</td></tr>'; lastArea = area; }
    no++;
    const total = Number(it.total != null ? it.total : (Number(it.qty) || 0) * (Number(it.price) || 0)) || 0;
    rows += '<tr><td class="c">' + no + '</td><td>' + E(it.name || '') + (it.spec ? '<span class="spec">' + E(it.spec) + '</span>' : '') + '</td>'
      + '<td class="c">' + E(it.qty) + (it.unit ? ' ' + E(it.unit) : '') + '</td><td class="r">' + money(it.price) + '</td><td class="r">' + money(total) + '</td><td class="c">每月</td></tr>';
  });
  fees.forEach(function(f) {
    const a = feeAmt(f); no++;
    const kind = a < 0 ? '每月' : (String(f.name || '').indexOf('押金') >= 0 ? '押金' : '一次性');
    rows += '<tr><td class="c">' + no + '</td><td>' + E(f.name || f.label || '其他費用') + (f.spec ? '<span class="spec">' + E(f.spec) + '</span>' : '') + '</td>'
      + '<td class="c">1 式</td><td class="r">' + money(a) + '</td><td class="r">' + money(a) + '</td><td class="c">' + kind + '</td></tr>';
  });

  const sumRow = function(k, vv, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="k">' + k + '</td><td class="v">' + vv + '</td></tr>'; };
  let sums = sumRow('每月品項小計（未稅）', money(itemsSum));
  if (negFees < 0) sums += sumRow('每月折扣', money(negFees));
  if (taxOn) sums += sumRow('營業稅 5%', money(monthly - monthlyNet));
  sums += sumRow('每月月費（' + (taxOn ? '含稅' : '未稅') + '）', money(monthly));
  const shortD = function(x) { return String(x || '').replace(/^\d{4}\//, ''); };
  if (fp) sums += sumRow('首期畸零 ' + E(shortD(fp.from)) + '–' + E(shortD(fp.to)) + '（' + Number(fp.days || 0) + (fp.monthDays ? '／' + Number(fp.monthDays) : '') + ' 天）', money(fpAmt));
  if (oneTime > 0) sums += sumRow('一次性費用（' + (taxOn ? '含稅' : '未稅') + '）', money(oneShow));
  if (deposit > 0) sums += sumRow('押金（不計稅・退租退還）', money(deposit));
  sums += sumRow('首期應付合計', money(grand), credits.total > 0 ? '' : 'grand');
  if (credits.total > 0) {
    credits.list.forEach(function(c) { sums += sumRow('－' + E(c.name), money(-c.amount)); });
    sums += sumRow('首期實付', money(Math.max(0, grand - credits.total)), 'grand');
  }

  const notes = [
    '本附件依報價單 ' + E(rec.quoteNo || p.報價單號) + '（' + E(rec.date || '') + '）製作，為本合約之一部分；品項如經雙方依「參、服務量調整」變更，以調整後之明細為準。',
    (fp ? '首期畸零費用＝每月月費 ÷ 當月天數 × 實際服務天數；自次月起依每月月費按月收取。' : '首期＝當月月費＋押金及一次性費用；次月起依每月月費按月收取。'),
    '損壞賠償依本表單價協商（肆、養護服務內容第八項）；植栽為自然產品、實際形態以現場交付為準。'
  ];
  if (credits.total > 0) notes.splice(2, 0, '首期折抵為已收之款項（' + credits.list.map(function(c) { return E(c.name); }).join('、') + '），於首期應付中全額扣回、僅扣一次。');
  return '<div class="doc axwrap">'
    + '<table class="sec"><tr><td class="tk"><div></div></td><td class="lb">附件一　植栽明細表</td><td class="rl"><div></div></td></tr></table>'
    + '<div class="axmeta">合約編號 ' + E(p.合約編號 || '') + '　·　設置地點 ' + E(p.設置地點 || '') + '　·　報價單 ' + E(rec.quoteNo || p.報價單號) + '</div>'
    + '<table class="ax"><colgroup><col style="width:9mm"><col><col style="width:16mm"><col style="width:23mm"><col style="width:25mm"><col style="width:17mm"></colgroup>'
    + '<thead><tr><th class="c">#</th><th>品項／規格</th><th class="c">數量</th><th class="r">單價</th><th class="r">小計</th><th class="c">性質</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<table class="axsum"><tr><td style="width:44%"></td><td style="width:56%;padding:0"><table class="axsum" style="margin:0">' + sums + '</table></td></tr></table>'
    + '<div class="axnote">' + notes.map(function(t, i) { return (i + 1) + '. ' + t; }).join('<br>') + '</div>'
    + '</div>';
}

function _contractRenderOutsourcingHtml_(p, stampUri, opts) {
  opts = opts || {};
  const E = _contractEsc_;
  const v = function(x) { return E(x == null ? '' : x); };
  const rd = function(x) { return E(_contractRocDate(x)); };
  const chap = function(label) {
    return '<table class="sec"><tr><td class="tk"><div></div></td><td class="lb">' + E(label) + '</td><td class="rl"><div></div></td></tr></table>';
  };
  const pp = function(t) { return '<p class="cp">' + t + '</p>'; };
  const ss = function(t) { return '<p class="cs">' + t + '</p>'; };
  const listOf = function(x) {
    if (Array.isArray(x)) return x.map(function(s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
    return String(x == null ? '' : x).split(/[\n;；]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  };

  let b = '';
  b += pp('甲方（委託方）：植間設計股份有限公司');
  b += pp('乙方（承攬人）：' + v(p.乙方姓名));
  b += pp('甲方為執行「' + v(p.專案名稱) + '」（以下稱本專案），委由乙方以承攬方式提供勞務，經雙方友好協商，訂立本合約如下：');

  b += chap('壹、承攬標的與工作範圍');
  b += pp('一、本專案名稱：' + v(p.專案名稱) + '。');
  b += pp('二、協同前提：本專案以雙方協力為前提規劃工作範圍——甲方負責專案所需之採購與材料費用、與業主之對外協調及資源調度；乙方負責推進專案執行、提供專業勞務與必要之進度回報。');
  b += pp('三、乙方承攬之工作範圍如下：');
  listOf(p.工作範圍).forEach(function(t, i) { b += ss('（' + (i + 1) + '）' + E(t)); });
  b += pp('四、工作範圍如有增減，應經雙方確認後以書面（含通訊軟體文字紀錄）為憑，涉及報酬調整者依參、報酬與付款辦理。');

  const onsite = listOf(p.現場必要事項);
  const remote = listOf(p.遠端可執行事項);
  if (onsite.length || remote.length) {
    b += chap('貳、工作方式');
    if (onsite.length) b += pp('一、下列事項乙方應親自到場執行：' + E(onsite.join('、')) + '。');
    if (remote.length) b += pp((onsite.length ? '二' : '一') + '、下列事項得以遠端方式執行：' + E(remote.join('、')) + '。');
    b += pp((onsite.length && remote.length ? '三' : '二') + '、乙方得自行安排工作時間與方法，惟應配合本專案時程及甲方與業主協調之現場作業時段。');
  }

  b += chap('參、報酬與付款');
  // 零、報酬總覽：有交付獎金才顯示（先講總額、對外包溝通友善；單一執行費案件不受影響）
  const _rwNum = function (x) { return Number(String(x == null ? '' : x).replace(/[^0-9.]/g, '')) || 0; };
  const _rwComma = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  if (String(p.交付獎金 || '').trim()) {
    b += pp('零、報酬總覽：本專案總報酬為新台幣 ' + _rwComma(_rwNum(p.執行報酬) + _rwNum(p.交付獎金)) + ' 元整，由下列執行報酬與交付獎金兩部分組成。');
  }
  b += pp('一、執行報酬：本專案承攬報酬為新台幣 ' + v(p.執行報酬) + ' 元整。');
  let payIdx = 2;
  if (String(p.交付獎金 || '').trim()) {
    b += pp('二、交付獎金：本專案如期且經甲方驗收通過者，甲方另給付交付獎金新台幣 ' + v(p.交付獎金) + ' 元整。');
    payIdx = 3;
  }
  const payNumMap = ['', '一', '二', '三', '四', '五', '六'];
  b += pp(payNumMap[payIdx] + '、請款與給付：乙方完成工作並經甲方驗收通過後，由乙方提供勞務報酬單；甲方於驗收通過日之次月十日將報酬匯入乙方指定帳戶（遇例假日順延至次一營業日）。');
  if (String(p.付款帳號 || '').trim()) {
    b += ss('匯款帳戶：<br>銀行：' + v(p.付款銀行) + '<br>帳號：' + v(p.付款帳號) + '<br>戶名：' + v(p.戶名 || p.乙方姓名));
  } else {
    b += ss('匯款帳戶：<br>銀行：＿＿＿＿＿＿＿＿＿＿＿＿<br>帳號：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿<br>戶名：＿＿＿＿＿＿＿＿＿＿＿＿');
  }
  b += pp(payNumMap[payIdx + 1] + '、稅務：本報酬屬執行業務所得／勞務報酬，甲方依法辦理扣繳與申報；乙方應配合提供必要之個人資料。');

  b += chap('肆、雙方權利義務');
  b += pp('一、甲方協力義務：甲方應提供乙方執行本專案所需之資訊、圖說與協調支援；專案所需之材料、資材採購費用由甲方負擔，乙方無須墊付（如經甲方同意先行代墊者，憑單據實報實銷）。');
  b += pp('二、乙方應以善良管理人之注意義務，依業界水準推進並完成受託工作，確保成果品質符合雙方確認之需求，並適時回報進度。');
  b += pp('三、責任界線：乙方僅就其受託執行範圍內、可歸責於乙方之事由負責；超出乙方專業能力或授權範圍之事項（包含但不限於重大採購決策、對業主之商務承諾、設計之最終定案），由甲方決策並承擔責任。乙方於執行中發現風險、障礙或超出範圍之需求時，應即時回報甲方，由甲方協調處理。');
  b += pp('四、乙方於現場作業時應遵守作業場所之安全規範；因可歸責於乙方之事由致甲方、業主或第三人受損害者，乙方就其可歸責之部分負賠償責任。');
  b += pp('五、本合約屬承攬性質，乙方非甲方之受僱人，雙方不成立僱傭關係；乙方自行安排其勞務提供之方式與過程。');

  b += chap('伍、智慧財產與保密');
  b += pp('一、乙方因執行本專案所完成之設計、圖說、文件及其他工作成果，其智慧財產權於甲方給付全部報酬後歸屬甲方；乙方得於個人作品集中展示，惟涉及業主機密或未公開資訊者應先取得甲方同意。');
  b += pp('二、乙方對於因本專案知悉之甲方或業主之商業資訊、報價、客戶資料等，負保密義務；本義務於合約終止後二（2）年內持續有效。');

  b += chap('陸、契約終止與取消');
  if (String(p.取消條款 || '').trim()) {
    b += pp('一、' + v(p.取消條款));
  } else {
    b += pp('一、任一方欲終止本合約，應以書面通知他方；已完成之工作按進度比例結算報酬。');
  }
  b += pp('二、因可歸責於乙方之事由致工作無法完成或品質重大瑕疵，經甲方通知限期改善仍未改善者，甲方得終止本合約，未完成部分之報酬不予給付。');
  b += pp('三、因不可抗力致本專案無法履行者，雙方按已完成進度結算，互不請求其他損害賠償。');

  b += chap('柒、其他');
  b += pp('一、本合約未盡事宜，依中華民國法令及誠信原則辦理；因本合約涉訟者，雙方合意以台灣台北地方法院為第一審管轄法院。');
  b += pp('二、本合約一式兩份，雙方各執一份，自雙方簽署日起生效。');

  // 特約條款（選填）：雙方校對後議定的增補／修改，逐條列出、效力優先於前列各條
  const special = listOf(p.特約條款);
  if (special.length) {
    b += chap('特約條款');
    b += pp('經雙方協商議定下列特約條款，如與本合約其他條款牴觸，以特約條款為準：');
    const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    special.forEach(function(t, i) { b += pp((cn[i] || (i + 1)) + '、' + E(t)); });
  }

  // 簽名頁：甲方＝植間（合約章）、乙方＝承攬人（電子簽合成於此側）
  const stampHtml = stampUri ? '<img class="stamp" src="' + stampUri + '" alt="合約專用章">' : '';
  const eSig = opts.signature || null;
  const partyBSigBlock = eSig && eSig.uri
    ? '<div class="sp"><img class="stamp" src="' + eSig.uri + '" alt="乙方簽名"></div>'
      + '<div class="esign-note">電子簽署：' + E(eSig.name || '') + '　' + E(eSig.at || '') + '</div>'
    : '<div class="sp"></div>';
  const rocLine = (function() {
    const m = String(p.簽訂日期 == null ? '' : p.簽訂日期).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return '中華民國　' + (Number(m[1]) - 1911) + '　年　' + Number(m[2]) + '　月　' + Number(m[3]) + '　日';
    return '中華民國　＿＿＿　年　＿＿　月　＿＿　日';
  })();
  const sig = '<div class="sigwrap"><table class="sig"><tr>'
    + '<td class="sc">'
    +   '<div class="st">甲方（委託方）　簽署</div>'
    +   '<div class="sn">植間設計股份有限公司<br>統一編號：90877240<br>代表人：林瑋恒　<span class="seal">（合約專用章）</span><br>聯絡地址：新北市中和區連城路569巷9弄26號1樓<br>聯絡電話：02-2221-0318</div>'
    +   '<div class="sgp">簽名 / 蓋章：</div>'
    +   '<div class="sp">' + stampHtml + '</div>'
    + '</td>'
    + '<td class="sc">'
    +   '<div class="st">乙方（承攬人）　簽署</div>'
    +   '<div class="sn">姓名：' + v(p.乙方姓名) + '<br>身分證字號：' + v(p.乙方身分證字號) + '<br>聯絡地址：' + v(p.乙方地址) + '<br>聯絡電話：' + v(p.乙方電話) + '</div>'
    +   '<div class="sgp">簽名：' + (eSig ? '（已電子簽署）' : '（請親簽）') + '</div>'
    +   partyBSigBlock
    + '</td>'
    + '</tr></table>'
    + '<p class="rocdate">' + rocLine + '</p></div>';

  const coverSignDate = p.簽訂日期 ? rd(p.簽訂日期) : '中華民國　　年　　月　　日';
  const versionStamp = opts.draft
    ? '<div class="draftmark">未定版預覽　·　僅供確認內容、不可簽署</div>'
    : (opts.finalNo
        ? '<div class="finalmark">正式定版　·　' + E(opts.finalNo) + '　·　' + E(opts.stampAt || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')) + ' 產生</div>'
        : '');
  const cover = '<div class="cover">'
    + '<div class="ck">YUZHIPLANT　·　植間設計</div>'
    + '<div class="ttl">案子承攬契約書</div>'
    + '<div class="cvrule"></div>'
    + '<table class="cinfo">'
    +   '<tr><td class="k">專案名稱</td><td class="vv">' + v(p.專案名稱) + '</td></tr>'
    +   '<tr><td class="k">承攬人</td><td class="vv">' + v(p.乙方姓名) + '</td></tr>'
    +   '<tr><td class="k">簽訂日期</td><td class="vv">' + coverSignDate + '</td></tr>'
    +   '<tr><td class="k">合約編號</td><td class="vv">' + v(p.合約編號) + '</td></tr>'
    + '</table>'
    + '<div class="cver">2026-07 v4（報酬總覽先講總額／付款次月十日／協同前提／責任界線）</div>'
    + versionStamp
    + '</div>';   // named page（coverpg→預設）切換自帶分頁；再放 page-break div 會夾出整張空白頁（2026-08-28 實案）

  return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>'
    + (opts.draft ? '【未定版預覽】' : '') + v(p.專案名稱) + ' 案子承攬合約</title><style>' + _contractCss_() + '</style></head><body>'
    + cover
    + '<div class="doc"><h1 class="h1">案子承攬合約</h1>' + b + sig + '</div>'
    + '</body></html>';
}

// 類型登記：與 GAS CONTRACT_RENDER_TYPES 同名 key、只留 render（其餘欄位＝GAS 流程用、這裡不需要）
var CONTRACT_RENDER_TYPES = {
  'subscription-care': { render: function (p, opts) { return _contractRenderHtml_(p, _contractStampDataUri_(), opts); } },
  'outsourcing-project': { render: function (p, opts) { return _contractRenderOutsourcingHtml_(p, _contractStampDataUri_(), opts); } }
};
