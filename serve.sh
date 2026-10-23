#!/usr/bin/env bash
# Serve Oscar Charts on http://localhost:8765
# Prefer this over file:// so Binance REST + WebSocket work cleanly in the browser.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Oscar Charts → http://localhost:${PORT}"
echo "Press Ctrl+C to stop."
exec python3 -m http.server "$PORT"
