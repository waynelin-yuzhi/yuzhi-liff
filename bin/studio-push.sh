#!/bin/bash
# 植影所自助部署（微調台 reels-tuner.html 與其素材）——守衛通過才 push GitHub Pages
# 用法：bash ~/yuzhi-liff/bin/studio-push.sh "commit 訊息"
# 白名單外的檔案有異動＝擋下（對客簽核頁等由總管管、植影所不碰）
set -euo pipefail
cd /Users/waynelin/yuzhi-liff

MSG="${1:-微調台更新}"
ALLOW_RE='^(reels-tuner\.html|previews/|frames/|bin/studio-push\.sh)'

CHANGED=$(git status --porcelain | awk '{print $2}')
[ -z "$CHANGED" ] && { echo "沒有異動、不用推"; exit 0; }

BAD=$(echo "$CHANGED" | grep -Ev "$ALLOW_RE" || true)
if [ -n "$BAD" ]; then
  echo "✗ 白名單外檔案有異動、擋下（植影所只准動 reels-tuner.html / previews/ / frames/）："
  echo "$BAD"
  exit 1
fi

# 零機密掃描（cowork key／supabase token／sk- 前綴）
if grep -rn "4454fddb\|sk-ant-\|1f139898\|SUPABASE_SERVICE" reels-tuner.html 2>/dev/null; then
  echo "✗ 疑似機密出現在 reels-tuner.html、擋下"; exit 1
fi
# noindex 必在
grep -q 'name="robots" content="noindex' reels-tuner.html || { echo "✗ reels-tuner.html 缺 noindex meta、擋下"; exit 1; }
# 單檔上限 2MB（GitHub Pages 快、預覽片放 previews/ 且 360p）
BIG=$(find reels-tuner.html previews frames -type f -size +2M 2>/dev/null || true)
[ -n "$BIG" ] && { echo "✗ 超過 2MB 的檔、擋下："; echo "$BIG"; exit 1; }

git add reels-tuner.html previews frames bin/studio-push.sh 2>/dev/null || true
git commit -m "$MSG"
git push origin main
echo "✓ 已推 GitHub Pages（約 1 分鐘生效）：https://waynelin-yuzhi.github.io/yuzhi-liff/reels-tuner.html"
