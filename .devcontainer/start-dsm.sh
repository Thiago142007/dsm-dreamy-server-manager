#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PID_FILE="/tmp/dsm-server.pid"
LOG_FILE="/tmp/dsm-server.log"
PORT_VALUE="${PORT:-3000}"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "DSM is already running on port $PORT_VALUE."
  exit 0
fi

HOST=0.0.0.0 PORT="$PORT_VALUE" npm start >"$LOG_FILE" 2>&1 &
echo "$!" >"$PID_FILE"
echo "DSM started on port $PORT_VALUE. Logs: $LOG_FILE"
