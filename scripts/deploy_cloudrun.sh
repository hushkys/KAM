#!/usr/bin/env bash
# Nasadí KAM na Cloud Run s databází PŘÍMO V OBRAZU (SQLite), bez Neonu.
#
#   bash scripts/deploy_cloudrun.sh
#
# Proč: 15. 10. 2026 vyčerpal bezplatný Neon kvótu na přenesená data
# a produkce vracela 500. Databáze v obrazu žádnou kvótu nemá a čte se
# z disku kontejneru. Cena: co lidé na serveru zapíšou (podněty, historie
# asistenta), vydrží jen do restartu nebo dalšího nasazení. Proto jediná
# instance (--max-instances 1), aby všichni viděli totéž, a čtyři procesy
# uvnitř (KAM_WORKERS=4), aby to stačilo na stovky lidí najednou.
#
# Stavba jde z dočasné složky: kód (sledované soubory i neuložené změny),
# konzistentní kopie data/kam.db a upravené .gcloudignore/.dockerignore,
# které databázi propustí. Repozitář ani jeho ignore soubory se nemění,
# databáze se nikdy nedostane do gitu. Šifrovací klíč, .env ani env.yaml
# do stavby nejdou.
#
# gcloud musí být přihlášený (nebo mít CLOUDSDK_AUTH_ACCESS_TOKEN — viz
# scripts/gcloud_token.py, když přihlášení v přenosné instalaci nedrží).
set -euo pipefail
export PYTHONIOENCODING=utf-8

KOREN="$(cd "$(dirname "$0")/.." && pwd)"
GCLOUD="${GCLOUD:-gcloud}"
PY="${PYTHON:-/c/Users/hushkys/AppData/Local/Programs/Python/Python312/python.exe}"
ST="$(mktemp -d)"; trap 'rm -rf "$ST"' EXIT

# Klíče ke Gemini se berou z .env (mimo git) a jdou jen do proměnných služby.
GEMINI_VSECHNY="$("$PY" -c "
import pathlib, re, sys
t = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'(?m)^GEMINI_API_KEYS\s*=\s*(.+)$', t)
print(m.group(1).strip() if m else '')" "$KOREN/.env")"
GEMINI_PRVNI="${GEMINI_VSECHNY%%,*}"
[ -n "$GEMINI_VSECHNY" ] || echo "   (v .env nejsou GEMINI_API_KEYS — asistent poběží v záložním režimu)"

echo "== 1/3 Stavební složka"
( cd "$KOREN" && git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - ) | tar -xf - -C "$ST"

echo "== 2/3 Databáze do obrazu"
"$PY" - "$KOREN" "$ST" <<'PY'
import re, sqlite3, sys, pathlib
koren, st = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cil = st / "data" / "kam.db"
src = sqlite3.connect(koren / "data" / "kam.db"); dst = sqlite3.connect(cil); src.backup(dst); src.close()
# Klíč Gemini je v místní databázi zašifrovaný místním klíčem, produkce má
# jiný (KAM_SECRET_KEY). Prázdný vypnutý řádek si aplikace při startu
# převezme a zašifruje klíčem z GEMINI_API_KEY (providers.seed_defaults).
dst.execute("update model_provider set api_key_enc = '', enabled = 0 where kind = 'gemini'")
dst.commit(); dst.execute("pragma journal_mode=delete"); dst.close()
print(f"   kam.db {cil.stat().st_size / 1048576:.0f} MB")
for jmeno in (".gcloudignore", ".dockerignore"):
    p = st / jmeno
    p.write_text(re.sub(r"(?m)^data/\*\.db$", "# data/*.db — tahle stavba databázi přibaluje", p.read_text(encoding="utf-8")), encoding="utf-8")
p = st / "Dockerfile"; s = p.read_text(encoding="utf-8")
a = "COPY data/geo/ ./data/geo/\n"
assert a in s, "Dockerfile se změnil — uprav scripts/deploy_cloudrun.sh"
p.write_text(s.replace(a, a + "COPY data/kam.db ./data/kam.db\n"), encoding="utf-8")
for tajne in ("env.yaml", ".env", "secrets.env", "data/secret.key"):
    assert not (st / tajne).exists(), f"{tajne} se nesmí dostat do stavby"
PY

echo "== 3/3 Cloud Run"
# Proměnné jdou přes dočasný YAML, ne přes příkazovou řádku: klíče ke Gemini
# jsou oddělené čárkou a `gcloud.cmd` na Windows bere `|` i `^` jako příkazy
# shellu. Základ je env.yaml (mimo git) bez DATABASE_URL — databáze je v obrazu.
ENVSL="$(mktemp --suffix=.yaml)"; trap 'rm -rf "$ST" "$ENVSL"' EXIT
{
  grep -v -E '^(DATABASE_URL|GEMINI_API_KEY|GEMINI_API_KEYS|KAM_WORKERS|KAM_OBNOVA_V_SERVERU):' "$KOREN/env.yaml" | tr -d '\r' || true
  echo "KAM_WORKERS: \"4\""
  echo "KAM_OBNOVA_V_SERVERU: \"0\""
  echo "GEMINI_API_KEY: \"$GEMINI_PRVNI\""
  echo "GEMINI_API_KEYS: \"$GEMINI_VSECHNY\""
} > "$ENVSL"
"$GCLOUD" run deploy kam --source "$ST" --region europe-west1 --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --cpu 4 --memory 8Gi --concurrency 250 --timeout 300 --cpu-boost \
  --env-vars-file "$ENVSL" --quiet

echo "== Ověření"
curl -s -m 30 https://hack-a-ton-hushkys.web.app/api/health; echo
