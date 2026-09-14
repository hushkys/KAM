#!/usr/bin/env bash
# KAM — spuštění na macOS a Linuxu.
#   ./start.sh            spustí aplikaci na http://127.0.0.1:8000
#   ./start.sh --lan      zpřístupní ji i v místní síti (test na telefonu)
#   ./start.sh --refresh  znovu stáhne otevřená data
set -euo pipefail
cd "$(dirname "$0")"

HOST="127.0.0.1"; PORT="${KAM_PORT:-8000}"; REFRESH=0
for a in "$@"; do
  case "$a" in
    --lan) HOST="0.0.0.0" ;;
    --refresh) REFRESH=1 ;;
    *) echo "Neznámý přepínač: $a"; exit 2 ;;
  esac
done

PY="$(command -v python3 || command -v python || true)"
[ -z "$PY" ] && { echo "Chybí Python 3.10+ (https://www.python.org/downloads/)"; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Potřebujete Python 3.10 nebo novější."; exit 1; }

if [ ! -d .venv ]; then
  echo "› Vytvářím virtuální prostředí…"
  "$PY" -m venv .venv
fi
VPY=".venv/bin/python"
echo "› Instaluji závislosti…"
"$VPY" -m pip install --quiet --upgrade pip
"$VPY" -m pip install --quiet -r requirements.txt

if [ ! -f frontend/dist/index.html ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "› Sestavuji frontend…"
    (cd frontend && npm ci --no-audit --no-fund && npm run build)
  else
    echo "Chybí sestavený frontend a Node.js (https://nodejs.org). Nainstalujte Node.js 20+ a spusťte znovu."; exit 1
  fi
fi

if [ ! -f data/kam.db ] || [ "$REFRESH" = 1 ]; then
  echo "› Stahuji a zpracovávám otevřená data (první spuštění, několik minut)…"
  (cd backend && "../$VPY" -m kam.ingest all)
fi

URL="http://127.0.0.1:${PORT}"
echo "› KAM běží na ${URL}  (Ctrl+C ukončí)"
( sleep 2; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true ) >/dev/null 2>&1 &
exec "$VPY" -m uvicorn kam.main:app --app-dir backend --host "$HOST" --port "$PORT"
