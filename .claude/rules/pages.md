---
paths: ["**/*.html", "**/*.js"]
globs: ["**/*.html", "**/*.js"]
---
# 改 GitHub Pages／LIFF 頁時才載入的規則

- **這裡是對外頁正本**：客戶簽回、員工 LIFF、收件匣 App 的頁殼互動改這裡；GAS 同名檔不是客戶看到的頁。改完網址加 `?v=` 破快取。
- **只能放 anon／publishable key**：service_role、cowork 主鑰、任何 secret 都不准出現在這個 repo（公開 repo）。
- **XSS**：資料塞進 `innerHTML` 一律先 escape；能用 `textContent` 就用。
- **LINE 內建瀏覽器**：要相機或 Google 登入的頁，連結加 `openExternalBrowser=1`；LIFF channel 必須是 Published，驗收用非開發者帳號實測。
- **設計系統**：苔綠 #5F6E58、米紙 #F2EDE3；圖示用自繪 SVG，禁 emoji。
- **寫入後同步**：按鈕寫入成功，畫面上被改到的東西同時更新，不要叫人重新整理。
