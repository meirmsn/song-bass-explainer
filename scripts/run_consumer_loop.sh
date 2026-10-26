#!/usr/bin/env bash
# Durable (systemd-less) poll loop for bass-private queued jobs.
# Logs: /workspace/bass-study/logs/consumer-YYYYMMDD.log
set -uo pipefail

ROOT="/workspace/bass-study"
LOG_DIR="$ROOT/logs"
WORK_PY="${BASS_TOOLS_PY:-/workspace/bass-tools/bin/python}"
CONSUMER="$ROOT/scripts/consume_jobs.py"
POLL_SECONDS="${BASS_CONSUMER_POLL:-30}"
PIDFILE="$LOG_DIR/consumer.pid"

mkdir -p "$LOG_DIR"

# Node for yt-dlp
unset NPM_CONFIG_PREFIX || true
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi
if command -v node >/dev/null 2>&1; then
  export BASS_NODE="$(command -v node)"
fi

# faster-whisper venv for non-LAP transcription (see WHISPER.md)
export BASS_WHISPER_PYTHON="${BASS_WHISPER_PYTHON:-/workspace/.venv-whisper/bin/python}"
export BASS_WHISPER_MODEL="${BASS_WHISPER_MODEL:-base.en}"

if [[ -f "$PIDFILE" ]]; then
  old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "consumer already running pid=$old" >&2
    exit 0
  fi
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

echo "$(date -Iseconds) consumer loop start poll=${POLL_SECONDS}s node=${BASS_NODE:-none} pid=$$" | tee -a "$LOG_DIR/consumer-$(date +%Y%m%d).log"

while true; do
  day="$(date +%Y%m%d)"
  log="$LOG_DIR/consumer-$day.log"
  {
    echo "---- $(date -Iseconds) cycle ----"
    "$WORK_PY" "$CONSUMER" --once --limit 1
    rc=$?
    echo "cycle_rc=$rc"
  } >>"$log" 2>&1 || true
  sleep "$POLL_SECONDS"
done
