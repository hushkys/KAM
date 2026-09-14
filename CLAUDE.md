# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

KAM — Krajský analytický model. Hackathon Královéhradeckého kraje, tým Popojedem.
FastAPI backend (`backend/kam`), React + TypeScript + Vite frontend (`frontend/`), SQLite by default (PostgreSQL via `DATABASE_URL`). All UI copy, log messages and docstring-level vocabulary are Czech; keep it that way.

## Commands

```bash
python -m pytest
```

```bash
python -m pytest backend/tests/test_trends.py::test_flat_series_is_stable -q
```

```bash
cd frontend && npm run build
```

```bash
cd frontend && npm run lint
```

```bash
cd frontend && npm test
```

```bash
cd frontend && npx vitest run -t "formats Czech numbers"
```

```bash
cd backend && python -m kam.ingest all
```

`npm run build` is `tsc -b && vite build`; `npm run lint` is the same type-check without emit. `python -m kam.ingest` takes individual steps (`geo`, `relief`, `catalog`, `eurostat`, `mos`, `khk`, `link`, `check`, `rag`, plus `check-new` and `admin`); each is idempotent and `all` runs them in dependency order. A full harvest takes minutes and hits live open-data endpoints — prefer a single step, or work against the existing `data/kam.db`. `relief` needs `geo` to have run first (it reads the projection out of `khk.json`); `eurostat` is the slow one at roughly ten minutes, because it verifies every one of ~8 900 datasets against the kraj.

Run the server through the Browser preview (`.claude/launch.json`, name `kam`, port 8000). The server serves `frontend/dist`; `/assets` is mounted at startup, so build the frontend before starting the server. `frontend` also has a Vite dev server on 5173 that proxies `/api` to 8000.

Neither Node nor Python is on PATH on the dev machine; bare `python` hits the Microsoft Store alias stub and fails with code 9009. Node: prefix `$env:PATH = "C:\Users\hushkys\AppData\Local\Programs\nodejs;" + $env:PATH`. Python 3.12 with all requirements installed is at `C:\Users\hushkys\AppData\Local\Programs\Python\Python312\python.exe` — that absolute path is what `.claude/launch.json` uses. (`start.ps1` would instead create a `.venv`; there isn't one here.)

## Architecture

One direction of flow, and each stage owns one job:

```
ingest/  → models.Observation (+ Dataset, Territory, Poi, Fact)
         → analytics/store.py  (the only reader of series; in-memory cache)
         → analytics/{trends,profile,risks,forecast,simulate,gaps}.py
         → api/{data,model,ai,reports}.py  (REST + SSE under /api)
         → frontend/src/lib/api.ts → pages/
```

- **`indicators.py` is the registry everything keys on.** Each `Ind` carries `pillar`, `polarity` (is higher better?), `agg` (how obce roll up into ORP/okres/kraj: `sum`, `wavg:<code>`, `wavg_pop`) and `origin` (the real producer, since ČSÚ MOS republishes other agencies' data). Derived ratios are declared here and computed per year in `store.py`, never stored.
- **`territory.py`** keys on RÚIAN codes and publisher IČO, the same identifiers NKOD and ČÚZK use. Every function takes a kraj code — KHK is the first deployment, not a hard-coded assumption.
- **`analytics/store.py` is the single definition of "value of indicator X in territory T in year Y."** Profiles, risks, forecasts and the AI tools all read through it. It caches series in memory; `store.reset()` / `risks.reset()` / `simulate.reset()` must be called together after an ingest. The `kam.ingest` CLI is a separate process and does *not* reset a running server's caches — restart the server after a manual ingest. Only the in-app scheduled refresh (`main.py::_scheduler`) resets them in place.
- **`ingest/relief.py` samples ČÚZK DMR 5G into the projection the SVG map already uses.** It reads `projection` out of `khk.json` and inverts it, so a grid vertex and an obec outline land on the same spot and the 3D map can paint the choropleth into a canvas and use it as a texture. Change `geo.py::Projector` and the relief has to be rebuilt.
- **`main.py` starts instantly on purpose.** Risk ranking, the simulation cache, the local-model warm-up, missing embeddings and the scheduled refresh all run on background threads (`_warm`, `_scheduler`), gated by `KAM_BACKGROUND`. Tests set it to `0`.
- **`db.py` has no migration tool.** `create_all()` plus `_ensure_columns()`, which only ever *adds* nullable/defaulted columns so an older snapshot keeps working. Renaming or retyping a column will silently do nothing — plan schema changes accordingly. SQLite runs in WAL so the API reads while an ingest writes.
- **Two settings stores, split by purpose.** `config.py` reads the environment (and `.env`) for things that differ per machine. `prefs.py` keeps server-side policy in the database — what may leave the machine (AI policy, retention, webhook target), validated against `DEFAULTS`/`CHOICES`/`RANGES` on every write, with SSRF checks on webhook hosts. API keys typed into the UI are Fernet-encrypted by `security.py` with a key in `data/secret.key`, never returned to the browser.

## Deployment

`DEPLOY.md` is the runbook; the shape is one container (`Dockerfile`) serving API + SPA, PostgreSQL over `DATABASE_URL`, and the SQLite snapshot pushed once with `scripts/migrate_to_postgres.py`. Three things that are easy to get wrong:

- **Firebase Hosting cannot run this app** — it serves static files only. The Firebase project is a GCP project, so the container goes to Cloud Run and `firebase.json` rewrites `**` to it. The rewrite must cover *everything*: serving `frontend/dist` from the Hosting CDN would put the app shell in front of the password.
- `KAM_AUTH_PASSWORD` turns on HTTP Basic for the whole site (`main.py::gate`), with `/api/health` deliberately open so the platform can probe the container. Empty password = no gate, which is what a laptop wants.
- `KAM_SECRET_KEY` moves the Fernet key off disk. Without it every redeploy generates a new key and the API keys stored in `model_provider` stop decrypting.

## Rules that keep the product honest

- Every number shown comes from the database; never type numbers into UI copy. Catalogue counts come from `api/data.py::dataset_counts`, where the headline is `verified` (`check_status == "ok"`) and `total` additionally includes rows whose link failed or is missing.
- `Observation` holds only published values. Forecasts and simulations are computed on read and never written back.
- `Dataset.loaded` is set only by `ingest/link.py` for datasets whose values a harvester really read. `Dataset.usage` states how every other dataset is used (`katalog`, `rag`, `pokryti`, `cerstvost`, `mapa`, `model`) — a harvested dataset with no honest use does not belong in the catalogue.
- **NKOD is effectively the whole Czech open-data landscape and the harvest of it is complete** — 375 of 376 publishers, and the only gaps are the daily series that `collapse_series` folds on purpose (STK alone registers 10 026 daily files as 10 026 datasets). Low regional counts are reality, not a bug: Středočeský kraj really publishes 22 datasets, and the krajs with thousands have an *IS DTM* catalogue. Do not go looking for a paging bug there again, and do not pad the count.
- `ingest/eurostat.py` is where the remaining headroom was: European regional statistics for NUTS3 `CZ052` and NUTS2 `CZ05`. Every candidate is **verified by asking for the kraj's own values** and kept only if the answer is non-empty (775 of 8 880). `region_code` is coverage, not publisher, so only the NUTS3 ones carry 86; `CZ05` covers three krajs and carries 0.
- `ingest/catalog.py` treats NKOD as authoritative and merges portal records onto it by normalised title within the same kraj *or* by download URL; a series of ≥ `SERIES_MIN` (30) daily slices collapses into one record.
- Two harvester rules that are easy to break and expensive to notice:
  - **Page NKOD over IRIs, never over result rows.** `_page_filter` takes an explicit batch from `_all_iris`. The metadata query drops datasets whose title is neither Czech nor untagged, so a full window can return short; the old "short page ⇒ last page" rule silently lost ~60 % of every publisher (NKOD reports 1 943 datasets for KHK, the catalogue held 800).
  - **Call `_ensure_source` before `_store`.** `Dataset.source_id` is a foreign key, so a harvester that stores rows for a brand-new source fails the whole insert at the end of a ten-minute run with nothing but `FOREIGN KEY constraint failed`.
  - **Build the duplicate index without the source being harvested** (`_titles_by_region(exclude)` / `_urls(exclude)`). A feed compared against its own previous harvest matches every row as a duplicate of itself, stores none, and `_store` then deletes the lot.
- Assumptions in `analytics/simulate.py::ASSUMPTIONS` carry a value and a reason and are overridable per request.
- The LLM never computes numbers: `ai/tools.py` produces labelled briefs (FAKT/TREND/MODEL/SCÉNÁŘ) that the model explains.
- `trends.py` is deliberately robust statistics (Theil–Sen, Mann–Kendall, MAD z-scores) because small-obec counts are never normal; `risks.py` lowers confidence for small populations and short series.
- Citizens' reports (`crowd.py`) cluster into formal submissions but never feed back into `Observation`.

## AI notes

- Chat is one pipeline in `ai/assistant.py`: guard → commands → route → tools + retrieval → model, streamed as SSE (`meta`, `action`, `token`, `done`).
- App commands (`ai/commands.py`) run without a model and are validated against an allowlist; the model may emit `AKCE: {...}` lines, parsed and validated the same way.
- `ai/router.py` decides intent and tier from keyword evidence on unaccented text in microseconds; the model-based refinement is optional and falls back to the heuristic on any failure.
- `ai/rag.py` fuses BM25 (unaccented, prefix-stemmed for Czech inflection) with local embeddings via RRF. Vectors are built in the background; BM25 answers alone until they exist.
- `ai/guard.py` is three layers: input screen, retrieved context fenced as untrusted evidence, and a canary token in the system prompt that voids an answer if it leaks.
- Local servers get `reasoning_effort: "none"`: Gemma 4 otherwise spends its whole budget in `reasoning_content` and returns nothing.
- The local tier gets a compact brief (prefill is the slow part on Gemma 4 E4B).
- With no model reachable, the assistant returns the tool brief as a grounded fallback.
- The routed tier is tried first, then the other one, then the brief; the `done` SSE event carries the model that actually answered, because `meta` is emitted before the attempt and would otherwise credit the wrong one.
- Under the `local_only` data policy `cloud` is set to `None` in `assistant.py` before the router runs — the classification call would otherwise send the query to the cloud that the policy forbids.
- `GEMINI_API_KEY` in `.env` is enough: `seed_defaults` adopts the keyless placeholder row it seeded on a first run. Gemini answers 429/503 "high demand" on the shared tier, so `_gemini_stream` retries twice with a short backoff; 3.x flash models burn the whole output budget thinking unless `thinkingConfig.thinkingBudget` is 0.

## Tests

`backend/tests/conftest.py` sets `KAM_DATA_DIR`, `KAM_BACKGROUND=0`, `DATABASE_URL` and an unreachable `LOCAL_LLM_BASE_URL` *before* importing `kam`, because `config.settings` and the SQLAlchemy engine are created at import time. Anything that imports `kam` earlier breaks the isolation.

The session-scoped `synthetic_db` fixture builds a small fake kraj whose shape triggers known behaviour: Horní Testov is ageing, shrinking, losing people to migration and has no sewerage; Velké Město is stable but carries a one-off 2020 death spike. Assertions lean on those properties — extend the fixture rather than reshaping the existing towns.

Frontend tests are a single `src/lib/lib.test.ts` covering formatting, prefs, the router matcher and chart/map scales.

## Frontend traps

- No UI, chart or map libraries: `components/charts.tsx` and `components/maps.tsx` draw SVG by hand, `lib/router.tsx` is a ~120-line History API router, styles are three hand-written files in `src/styles/`.
- Do not put `view-transition-name` on fixed elements that carry `backdrop-filter` (navbar, dock): it produced black frames after scrolling.
- The dock highlight travels (`Dock.tsx::useTravellingHighlight`, ported from entry-rag's `morphIndicator`). Two shapes — a pill and a slower trail — inside a layer carrying the `#dock-goo` SVG filter, which fuses the gap between them into a stretching neck. The squash is a three-keyframe WAAPI animation because a CSS transition interpolates start to end and the stretch has to happen between them; width is animated because dock items differ in width. `park()` writes the final values inline *before* the animations run, so cancelling a finished `fill: forwards` drops onto an identical state. Active items therefore carry no background of their own — adding one back makes the highlight appear twice. Page motion is entrance-only by design — see the comment at the top of `lib/router.tsx`.
- Do not use `background-attachment: fixed`; the ambient glow is `body::before`.
- Visual preferences live in localStorage (`kam.prefs`) and are applied before paint by `public/theme-init.js`; keep it in step with `src/lib/prefs.ts`. Preferences become `data-*` attributes on `<html>` — the stylesheet decides what each one means, not components.
- Czech plural and number formatting live in `src/lib/format.ts`.
- Touch sizing lives in one `@media (pointer: coarse)` block at the **end of `pages.css`** — last file, last rule. A media query adds no specificity, so the same block placed in `base.css` lost to every component's own size. Sized by input device, not viewport: a tablet is a thumb, a small desktop window is a mouse.
- `Modal` takes `sheet` for dialogs that are mostly text (the dock's "Více"): opaque surface, heavier scrim, grab handle on a phone. Glass over a page of text is unreadable text — the same reason content surfaces in this app are opaque — and where `backdrop-filter` is unsupported the page shows straight through.
- A control nested inside a clickable card must `stopPropagation` (see `InfoHint`): without it one tap fired both. Its hit area grows with an `::after` overlay so the visual size can stay small.
- An indicator tile picks its own mark in `pages/Profile.tsx::shapeOf` — dial for a 0–100 % share, dots for a small one-year count, bullet for a snapshot with a kraj value, columns for a jumpy yearly flow, area for a stock, line when the trend engine flagged a spike. Add a mark to `components/charts.tsx` and a branch there; do not give everything a sparkline again.
- `.ind-grid` is `auto-fit` + `dense` with the first tile of each pillar spanning two columns (`.is-lead`), collapsing to one column under 560px.
- `ScenarioHook` stacks `backdrop-filter` panes. They are in normal flow, never fixed — that is the difference between this and the navbar bug above. Its curves are the real baseline/scenario arrays; with no result yet the panes stay empty rather than showing an invented shape.
- `components/Relief3D.tsx` is the only three.js in the app and is `React.lazy`-loaded from `MapPage`; it is a 510 kB chunk against a 449 kB app. The obec colours are a canvas texture, never per-vertex attributes, and a second canvas painted with index colours turns a raycast hit into an obec in one `getImageData`. Two things bite: exaggeration above ~8× turns a 300 m grid cell into a spike and the landscape stops being recognisable (the slider stops at 12), and OrbitControls claims every touch — on a coarse pointer the view starts locked (`touch-action: pan-y`, `controls.enabled = false`) so the page can still be scrolled past it.
- `lib/api.ts` wraps fetch with timeouts and a stale-while-revalidate cache; call `invalidate(prefix)` after a mutation instead of reloading.
