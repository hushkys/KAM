# Nasazení KAM

**Produkce běží:** <https://hack-a-ton-hushkys.web.app>
Za HTTP Basic — uživatel `kam`, heslo v `secrets.env` (necommituje se).

KAM je **jeden proces**: FastAPI obsluhuje API i sestavený frontend. Potřebuje
proto hosting, který umí běžet nepřetržitě — ne jen statické soubory.

| Co | Kde | Poznámka |
|---|---|---|
| Aplikace | Cloud Run `kam`, `europe-west1` | kontejner z `Dockerfile` |
| Veřejná adresa | Firebase Hosting | přepisuje `**` na Cloud Run |
| Databáze | Neon PostgreSQL, `eu-central-1` | `data/kam.db` má ~190 MB a disk kontejneru deploy nepřežije |
| Geometrie | v image (1,3 MB) | mapa ji potřebuje při každém požadavku |
| Model | Gemini přes API klíč | na serveru neběží LM Studio |

> **Firebase Hosting samo aplikaci neutáhne** — umí jen statické soubory.
> Projekt `hack-a-ton-hushkys` je zároveň projekt Google Cloudu, takže
> aplikace běží v Cloud Runu v témže projektu a Hosting na ni jen přepisuje
> provoz. Přepis pokrývá **všechny** cesty schválně: kdyby se frontend
> servíroval z CDN, byl by shell aplikace přístupný bez hesla.

## Parametry běžící služby

```
--min-instances 1 --max-instances 3 --cpu 1 --memory 1Gi --timeout 300
--port 8000 --allow-unauthenticated
```

`--allow-unauthenticated` znamená jen „Cloud Run nevyžaduje IAM token" —
veřejná je pouze výzva k zadání hesla, gate hlídá aplikace.
`--min-instances 1` drží instanci vzhůru, takže není studený start; stojí to
zhruba 10–15 $/měsíc. S `0` je to zdarma, ale první návštěva po pauze čeká ~3 s.

## Postup od nuly

### 1. Databáze

```bash
# Neon → New project → eu-central-1, connection string upravit na
# postgresql+psycopg://…?sslmode=require a zapsat do secrets.env
python scripts/migrate_to_postgres.py "$DATABASE_URL"
```

Skript vytvoří schéma, každou tabulku vyprázdní a naplní a srovná sekvence.
Po každé nové sklizni se dá spustit znovu. Poslední běh: 470 354 řádků.

### 2. Google Cloud

```bash
gcloud auth login
gcloud config set project hack-a-ton-hushkys
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

### 3. Nasazení

```powershell
.\scripts\deploy.ps1
```

Skript nejdřív sestaví frontend — levná kontrola, protože typová chyba pak
praskne za pět vteřin místo po pěti minutách v Cloud Buildu — a teprve pak
pošle zdroje na Cloud Run. Dvě věci má napevno kvůli tomuhle stroji a obě
jdou přebít proměnnou prostředí: `gcloud` není na PATH (`GCLOUD_CMD`) a bez
`CLOUDSDK_PYTHON` sáhne po `python`, což na Windows spadne do zástupce
Microsoft Store. Bez `env.yaml` v kořeni nasazovat odmítne: prázdné proměnné
by u běžící revize shodily připojení k databázi.

Ručně je to tohle. Proměnné se předávají souborem, ne `--set-env-vars` —
connection string obsahuje znaky, které by se v seznamu odděleném čárkami
rozbily:

```bash
gcloud run deploy kam --source . --region europe-west1 \
  --allow-unauthenticated --min-instances 1 --max-instances 3 \
  --cpu 1 --memory 1Gi --timeout 300 --port 8000 \
  --env-vars-file env.yaml
```

`env.yaml` (mimo repozitář) nese `DATABASE_URL`, `KAM_SECRET_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`LOCAL_LLM_BASE_URL`, `KAM_BACKGROUND`.

### 4. Veřejná adresa

```bash
firebase deploy --only hosting --project hack-a-ton-hushkys
```

### 5. Nastavení produkce

```bash
# obnovu dat na serveru nedělá kontejner, ale Cloud Run Job (viz „Obnova dat“ níž);
# kontejner bez stále přiděleného CPU by sklizeň mezi požadavky nedotáhl
curl -u kam:HESLO -X PUT -H "Content-Type: application/json" \
  -d '{"auto_refresh": false, "refresh_hours": 24}' https://…/api/settings/data
# na serveru neběží lokální model, ať na něj router nečeká
curl -u kam:HESLO -X PUT -H "Content-Type: application/json" \
  -d '{"policy":"cloud_preferred"}' https://…/api/settings/ai
```

## Na co se šlape

- **Nativní binárky vázané na platformu patří do `optionalDependencies`.**
  `@rolldown/binding-win32-x64-msvc` bylo v `devDependencies` a `npm ci`
  v linuxovém image spadl na `EBADPLATFORM`. Jako volitelná závislost ji cizí
  platforma přeskočí a Windows si ji dál nainstaluje. Lokální vývoj na Windows
  tohle nikdy neodhalí.
- **Přenosná instalace gcloudu si nemusí uložit přihlášení.**
  `gcloud auth login` sice napsal `legacy_credentials/<účet>/adc.json`, ale do
  `credentials.db` uložil nula řádků, takže `gcloud auth list` tvrdil, že žádný
  účet není. `--cred-file` authorized-user soubory nebere. Řešení: z refresh
  tokenu v `adc.json` vyrobit přístupový token a podat ho přes
  `CLOUDSDK_AUTH_ACCESS_TOKEN`.
- **gcloud bez Pythonu na PATH** potřebuje `CLOUDSDK_PYTHON`.
- **Heslo v URL (`https://user:pass@host`) nestačí.** Prohlížeč ho použije jen
  pro hlavní dokument, ne pro `fetch` — stránka se načte a API volání vrátí
  401. Skutečný uživatel dostane nativní dialog a pak už to funguje všude.

## Obnova dat

Obnovu dělá jedna funkce, `kam/refresh.py::obnov` — denně katalog, vrstvy
kraje, **poslední roky statistik ČSÚ** a párování sad, jednou za týden
kontrola odkazů, dotace a dokumenty obcí. Pustit ji jde dvojím způsobem:

- **v serveru**, když je v nastavení zapnutá automatická obnova. Plánovač se
  každých deset minut podívá do `job_state` („refresh“), kdy obnova naposledy
  doběhla, takže ji restart kontejneru nevynuluje. Na Cloud Run to ale nestačí:
  služba běží bez stále přiděleného CPU (`--no-cpu-throttling` není zapnuté),
  vlákno na pozadí mezi požadavky skoro nedostane procesor a desetiminutovou
  sklizeň by nedotáhlo. Proto je na produkci `auto_refresh: false`;
- **jako Cloud Run Job** — tentýž image, jiný příkaz, spouštěný Cloud
  Schedulerem. Job zapisuje rovnou do PostgreSQL; běžící služba si změny
  v `job_state` do deseti minut všimne a vyprázdní mezipaměti sama.

```bash
# jednou: job ze stejného image jako služba, se stejnými proměnnými z env.yaml
gcloud run jobs create kam-obnova --image REGION-docker.pkg.dev/PROJEKT/…/kam:latest \
  --region europe-west1 --env-vars-file env.yaml --cpu 1 --memory 1Gi --task-timeout 3600 \
  --command python --args=-m,kam.ingest,refresh
# denně ve 4:30 — úřední data se nemění v řádu hodin a ráno už je obnoveno
gcloud scheduler jobs create http kam-obnova-denne --location europe-west1 \
  --schedule "30 4 * * *" --time-zone "Europe/Prague" \
  --uri "https://europe-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJEKT/jobs/kam-obnova:run" \
  --http-method POST --oauth-service-account-email SLUZEBNI-UCET@PROJEKT.iam.gserviceaccount.com
# ručně kdykoli
gcloud run jobs execute kam-obnova --region europe-west1
```

Na co myslet: **Neon má na free tieru kvótu na přenesená data.** Statistiky
se proto nestahují celé (380 tisíc řádků), ale jen od roku před posledním,
který v databázi je, a kontrola dvaceti tisíc odkazů běží jednou týdně.
Vyprázdnění mezipamětí služby po obnově znamená jedno natažení sérií navíc —
stejně jako jeden studený start.

## Ověření po nasazení

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://hack-a-ton-hushkys.web.app/api/health    # 200
curl -s -o /dev/null -w '%{http_code}\n' https://hack-a-ton-hushkys.web.app/api/overview  # 401
curl -s -u kam:HESLO https://hack-a-ton-hushkys.web.app/api/overview | head -c 300        # data
```

Naposledy ověřeno: 23 839 sad (21 998 s ověřeným odkazem), 407 134 pozorování,
483 území, 11 616 zařízení, 134 ukazatelů. Asistent odpovídá přes Gemini za
~3,8 s s citovanými zdroji.

## Údržba

- **Nová data**: běžně je obnoví job `kam-obnova` (viz „Obnova dat“). Celou
  sklizeň od nuly jde udělat lokálně (`cd backend && python -m kam.ingest all`)
  a nahrát `scripts/migrate_to_postgres.py`. Jak čerstvá data jsou, říká
  `/api/aktualnost` a spodek postranního panelu v aplikaci.
- **Embeddingy**: vektorové vyhledávání potřebuje lokální embedding model.
  Na serveru žádný není, takže RAG jede na BM25 — navržený fallback, ne porucha.
