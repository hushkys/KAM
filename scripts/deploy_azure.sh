#!/usr/bin/env bash
# Nasadí KAM na virtuální stroj v Azure (Ubuntu 24.04) přes SSH.
#
#   KAM_SSH=azureuser@20.1.2.3 KAM_KLIC=~/.ssh/kam_azure \
#   KAM_DOMENA=kam-khk.polandcentral.cloudapp.azure.com KAM_WORKERS=4 \
#   bash scripts/deploy_azure.sh --s-daty
#
# --s-daty   nahraje i databázi (data/kam.db), šifrovací klíč a hranice.
#            Při prvním nasazení povinné; potom jen když se má přepsat to,
#            co na stroji je — přijde se tím o podněty a konverzace, které
#            mezitím vznikly na serveru.
#
# Kód se bere z pracovního stromu (sledované soubory, i neuložené změny),
# tajemství z .env (jen GEMINI_*). Nic z toho se nevypisuje.
set -euo pipefail
export PYTHONIOENCODING=utf-8

KOREN="$(cd "$(dirname "$0")/.." && pwd)"
: "${KAM_SSH:?Nastav KAM_SSH=uzivatel@adresa}"
: "${KAM_DOMENA:?Nastav KAM_DOMENA (DNS jméno stroje v Azure)}"
KAM_WORKERS="${KAM_WORKERS:-4}"
SSH_OPT=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
[ -n "${KAM_KLIC:-}" ] && SSH_OPT+=(-i "$KAM_KLIC")
S_DATY=0; [ "${1:-}" = "--s-daty" ] && S_DATY=1
PY="${PYTHON:-/c/Users/hushkys/AppData/Local/Programs/Python/Python312/python.exe}"
DOCASNE="$(mktemp -d)"; trap 'rm -rf "$DOCASNE"' EXIT

ssh_() { ssh "${SSH_OPT[@]}" "$KAM_SSH" "$@"; }
scp_() { scp "${SSH_OPT[@]}" "$@"; }

echo "== 1/6 Příprava stroje"
scp_ "$KOREN/deploy/azure/setup-vm.sh" "$KAM_SSH:/tmp/setup-vm.sh"
ssh_ "bash /tmp/setup-vm.sh"

echo "== 2/6 Balím kód"
( cd "$KOREN" && git ls-files -z --cached --others --exclude-standard | tar --null -T - -czf "$DOCASNE/app.tgz" )

echo "== 3/6 Nahrávám kód"
scp_ "$DOCASNE/app.tgz" "$KAM_SSH:/tmp/kam-app.tgz"
ssh_ "cd /srv/kam/app && find . -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} + && tar -xzf /tmp/kam-app.tgz && rm /tmp/kam-app.tgz"

echo "== 4/6 Tajemství"
# Jen to, co server potřebuje; hodnoty se nikde netisknou.
"$PY" - "$KOREN/.env" "$DOCASNE/kam.env" "$KAM_WORKERS" <<'PY'
import sys, pathlib
zdroj, cil, workers = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
radky = []
if zdroj.exists():
    for r in zdroj.read_text(encoding="utf-8").splitlines():
        k = r.split("=", 1)[0].strip()
        if k in ("GEMINI_API_KEY", "GEMINI_MODEL", "KAM_SECRET_KEY"):
            radky.append(r.strip())
radky += ["KAM_BACKGROUND=1", f"KAM_WORKERS={workers}", "LOCAL_LLM_BASE_URL=http://127.0.0.1:9"]
cil.write_text("\n".join(radky) + "\n", encoding="utf-8")
print("   klíče:", ", ".join(r.split("=", 1)[0] for r in radky))
PY
printf 'KAM_DOMENA=%s\nKAM_WORKERS=%s\n' "$KAM_DOMENA" "$KAM_WORKERS" > "$DOCASNE/compose.env"
scp_ "$DOCASNE/kam.env" "$KAM_SSH:/srv/kam/app/deploy/azure/kam.env"
scp_ "$DOCASNE/compose.env" "$KAM_SSH:/srv/kam/app/deploy/azure/.env"
ssh_ "chmod 600 /srv/kam/app/deploy/azure/kam.env /srv/kam/app/deploy/azure/.env"

if [ "$S_DATY" = 1 ]; then
  echo "== 5/6 Nahrávám data"
  # Konzistentní kopie i ve chvíli, kdy databázi drží běžící lokální server.
  "$PY" -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" \
    "$KOREN/data/kam.db" "$DOCASNE/kam.db"
  ( cd "$KOREN/data" && tar -czf "$DOCASNE/data.tgz" geo $( [ -f secret.key ] && echo secret.key ) )
  scp_ "$DOCASNE/kam.db" "$DOCASNE/data.tgz" "$KAM_SSH:/tmp/"
  ssh_ "cd /srv/kam/app/deploy/azure && (sudo docker compose stop kam 2>/dev/null || true) \
    && sudo rm -f /srv/kam/data/kam.db-wal /srv/kam/data/kam.db-shm \
    && sudo mv /tmp/kam.db /srv/kam/data/kam.db && sudo tar -xzf /tmp/data.tgz -C /srv/kam/data && rm /tmp/data.tgz \
    && sudo chown -R 10001:10001 /srv/kam/data"
else
  echo "== 5/6 Data beze změny (bez --s-daty)"
fi

echo "== 6/6 Sestavuji a spouštím"
ssh_ "cd /srv/kam/app/deploy/azure && sudo docker compose up -d --build --remove-orphans && sudo docker image prune -f >/dev/null"

echo "== Čekám na https://$KAM_DOMENA/api/health"
for i in $(seq 1 60); do
  if curl -fsS -m 10 "https://$KAM_DOMENA/api/health" 2>/dev/null | grep -q '"ok":true'; then
    echo "   Běží: https://$KAM_DOMENA"; exit 0
  fi
  sleep 5
done
echo "   Aplikace neodpověděla do 5 minut. Logy: ssh $KAM_SSH 'cd /srv/kam/app/deploy/azure && sudo docker compose logs --tail 100'"
exit 1
