# Nasazení KAM

KAM je **jeden proces**: FastAPI obsluhuje API i sestavený frontend. Potřebuje
proto hosting, který umí běžet nepřetržitě — ne jen statické soubory.

| Co | Čím | Proč |
|---|---|---|
| Aplikace | kontejner z `Dockerfile` | Python + pozadí (zahřátí modelu, plánovaná aktualizace dat) |
| Databáze | PostgreSQL (Neon) | `data/kam.db` má ~190 MB a disk kontejneru deploy nepřežije |
| Geometrie | v image (1,3 MB) | mapa ji potřebuje při každém požadavku, mezi sklizněmi se nemění |
| Heslo | HTTP Basic v aplikaci | funguje na každém hostingu, nepotřebuje účty |
| Model | Gemini přes API klíč | na serveru neběží LM Studio |

> **Firebase Hosting samo o sobě aplikaci neutáhne** — umí jen statické soubory.
> Projekt `hack-a-ton-hushkys` je zároveň projekt Google Cloudu, takže se
> aplikace nasadí do **Cloud Run** v témže projektu a Firebase Hosting na ni
> jen přepíše provoz. Veřejná adresa pak je
> `https://hack-a-ton-hushkys.web.app`. Cloud Run vyžaduje zapnutou fakturaci
> (plán Blaze); při běžném provozu tohohle typu se to pohybuje v jednotkách
> dolarů měsíčně, s `--min-instances=1` (bez studeného startu) zhruba
> 10–15 $/měsíc.

---

## 0. Co je potřeba jednou připravit

Vyplňte `secrets.env` (vznikl z `secrets.env.example`, je v `.gitignore`).
Předvyplněné už je: `KAM_SECRET_KEY`, `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`.
Chybí:

- `DATABASE_URL` — z Neonu (viz krok 1)
- `KAM_AUTH_PASSWORD` — heslo, kterým se bude vstupovat
- `GCP_SERVICE_ACCOUNT_KEY_FILE` **nebo** `RENDER_API_KEY` — podle zvolené cesty

## 1. Databáze (Neon)

1. <https://console.neon.tech> → **New project**, region `eu-central-1`.
2. Zkopírovat connection string a upravit prefix na `postgresql+psycopg://`
   a přidat `?sslmode=require`:
   ```
   postgresql+psycopg://user:heslo@ep-xxx.eu-central-1.aws.neon.tech/kam?sslmode=require
   ```
3. Zapsat do `secrets.env` jako `DATABASE_URL`.
4. Nahrát snímek (trvá pár minut, ~190 MB):
   ```bash
   python scripts/migrate_to_postgres.py "$DATABASE_URL"
   ```
   Skript vytvoří schéma, každou tabulku vyprázdní a naplní, a srovná
   sekvence. Po každé nové sklizni se dá spustit znovu.

## 2a. Cesta A — Firebase / Cloud Run (chtěná)

```bash
npm install -g firebase-tools           # firebase CLI
# gcloud SDK: https://cloud.google.com/sdk/docs/install

firebase login
firebase projects:create hack-a-ton-hushkys --display-name "KAM"
gcloud auth login
gcloud config set project hack-a-ton-hushkys
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

Nasazení kontejneru (build proběhne v Cloud Buildu, lokální Docker není potřeba):

```bash
gcloud run deploy kam \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 3 \
  --cpu 1 --memory 1Gi --timeout 300 \
  --set-env-vars "$(grep -E '^(DATABASE_URL|KAM_AUTH_USER|KAM_AUTH_PASSWORD|KAM_SECRET_KEY|GEMINI_API_KEY|GEMINI_MODEL|LOCAL_LLM_BASE_URL|KAM_BACKGROUND)=' secrets.env | paste -sd, -)"
```

`--allow-unauthenticated` znamená jen „Cloud Run nevyžaduje IAM token“ —
heslo hlídá aplikace, takže veřejná je pouze výzva k přihlášení.
`--min-instances 1` drží instanci vzhůru (žádný studený start).

Napojení veřejné adresy:

```bash
firebase deploy --only hosting
```

`firebase.json` přepisuje **všechny** cesty na službu `kam`, takže i
`index.html` a JS jde přes kontejner a je za heslem. Kdyby se frontend
servíroval z CDN Firebase, byl by shell aplikace veřejný.

## 2b. Cesta B — Render + Neon (levnější, rychlejší na rozjezd)

1. Repozitář na GitHub.
2. <https://dashboard.render.com> → **New → Blueprint** → vybrat repo.
   Render přečte `render.yaml`.
3. Doplnit v dashboardu hodnoty označené `sync: false`
   (`DATABASE_URL`, `KAM_AUTH_PASSWORD`, `KAM_SECRET_KEY`, `GEMINI_API_KEY`).
4. Plán **Starter** ($7/měsíc). Na free tieru služba po 15 minutách bez
   provozu usne a probouzí se ~50 s — to není „neomezený běh“.

Firebase se dá použít i tady: `firebase.json` přepsat z `run` na
`{"source": "**", "destination": ...}` proxy na Render doménu nejde přímo —
jednodušší je nechat adresu Renderu, nebo přidat vlastní doménu.

---

## Po nasazení zkontrolovat

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<adresa>/api/health        # 200, bez hesla
curl -s -o /dev/null -w '%{http_code}\n' https://<adresa>/api/overview      # 401
curl -s -u kam:<heslo> https://<adresa>/api/overview | head -c 300          # data
```

V aplikaci pak: **Nastavení → Modely AI** má ukazovat Gemini jako dostupný,
**Data** má hlásit stejné počty jako lokálně.

## Údržba

- **Nová data**: sklidit lokálně (`cd backend && python -m kam.ingest all`)
  a nahrát `scripts/migrate_to_postgres.py`. Aplikace na serveru si navíc
  jednou za `refresh_hours` (Nastavení → Data) sama obnoví katalog.
- **Embeddingy**: vektorové vyhledávání potřebuje lokální embedding model.
  Na serveru žádný není, takže RAG jede na BM25 — je to navržený fallback,
  ne porucha.
- **Změna hesla**: přepsat `KAM_AUTH_PASSWORD` v prostředí služby a nasadit
  znovu; nic v databázi se nemění.
