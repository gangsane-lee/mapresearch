#!/bin/bash
# AptLog 자동 실행을 macOS launchd(사용자 LaunchAgent)에 등록 — Windows 서비스·작업 스케줄러 대체
#   bash scripts/mac/install-launchd.sh             등록(재등록)
#   bash scripts/mac/install-launchd.sh --uninstall 해제
#
#   com.aptlog.api     API 서버 (로그인 시 시작, 죽으면 재시작) — 먼저 npm run build
#   com.aptlog.backup  매일 21:00 백업 (node scripts/backup.js)
#   com.aptlog.trades  매주 월 07:30 실거래 동기화 (최근 3개월)
# 맥이 잠자기 중이었으면 깨어난 뒤 실행된다. 전원이 꺼져 있던 동안의 일정은 건너뛴다.
# 로그: ~/Library/Logs/AptLog/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/AptLog"
LABELS=(com.aptlog.api com.aptlog.backup com.aptlog.trades)
DOMAIN="gui/$(id -u)"

for l in "${LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$l" 2>/dev/null || true
done
if [[ "${1:-}" == "--uninstall" ]]; then
  for l in "${LABELS[@]}"; do
    if [[ -f "$AGENTS/$l.plist" ]]; then mv "$AGENTS/$l.plist" "$AGENTS/$l.plist.disabled"; fi
  done
  echo "해제 완료 (plist 는 .disabled 로 이름만 바꿔 두었습니다)"
  exit 0
fi

NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || { echo "node 를 찾을 수 없습니다 (brew install node@24)"; exit 1; }
[[ -f "$ROOT/.env" ]] || { echo ".env 가 없습니다: $ROOT/.env"; exit 1; }
[[ -f "$ROOT/web/dist/index.html" ]] || { echo "web/dist 가 없습니다. 먼저 npm run build"; exit 1; }
mkdir -p "$AGENTS" "$LOGS"

# $1 label, $2 작업 폴더, $3 추가 키(XML), 나머지 = 실행 인자
write_plist() {
  local label="$1" wd="$2" extra="$3"; shift 3
  local args=""
  for a in "$@"; do args+="    <string>$a</string>"$'\n'; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>WorkingDirectory</key><string>$wd</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>EnvironmentVariables</key>
  <dict><key>LANG</key><string>ko_KR.UTF-8</string></dict>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
$extra
</dict>
</plist>
EOF
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
  echo "등록: $label"
}

write_plist com.aptlog.api "$ROOT/api" \
  '  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>' \
  "$NODE" --env-file=../.env src/server.js

write_plist com.aptlog.backup "$ROOT" \
  '  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>' \
  "$NODE" scripts/backup.js

write_plist com.aptlog.trades "$ROOT" \
  '  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>' \
  "$NODE" scripts/sync-trades.js --months 3

echo
echo "확인: launchctl list | grep aptlog   /   http://127.0.0.1:5180"
echo "즉시 실행: launchctl kickstart $DOMAIN/com.aptlog.backup"
