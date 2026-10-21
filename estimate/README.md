# 初估報價書（訂閱式）

版型正本：Claude Design 專案「初估報價書｜訂閱式母版」的 `初估報價書母版.dc.html`（2026-10-21）。這裡是去掉 Design 執行環境後的靜態版，資料驅動、A4 一頁一頁可列印。

- 資料來源（擇一）：`window.__YZ_QUOTE_DATA__`、`?data=<JSON 網址>`、預設 `sample.json`（版型展示用，只放植間自己的公開圖庫照）。
- 選項：`?wm=0` 關浮水印、`?legal=0` 關版權條、`?wmo=0.08` 浮水印濃度、`?co=0.9` 封面透明度、`?fade=0` 封面不漸層。
- 產 PDF：頁面全部圖片與字型就緒後 `body[data-ready="1"]`；headless Chrome `--print-to-pdf`（`@page A4 margin 0`）。
- 欄位：`client{name,site,issuedAt,validUntil}`、`coverPhoto`、`coverFocus`、`points[{name,note,sitePhoto,focus,size,qty,candidates[{name,photo,reason}]}]`、`sizeGuide[]`、`plans[{label,subtitle,rows[{size,qty}],monthlyEx,monthlyInc}]`、`minimumNote`、`pricingNotes[]`、`reportThumb`、`potStyles[]`（可省略、預設三種盆器風格）。
- 客戶現場照不可放進這個公開 repo；正式件的 JSON 與照片放私有位置、用 `?data=` 或注入。
