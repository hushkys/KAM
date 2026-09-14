# KAM — Krajský analytický model

**Vidět, kam to směřuje.** Živý model Královéhradeckého kraje: co se děje, proč, kam to vede a co se změní, když zasáhneme — nebo nezasáhneme.

Tým **Popojedem.** · Hackathon Královéhradeckého kraje · licence MIT

---

## Spuštění

| Systém | Příkaz |
|---|---|
| Windows | dvojklik na `start.bat` (nebo `.\start.ps1`) |
| macOS / Linux | `./start.sh` |

Skript vytvoří virtuální prostředí, nainstaluje závislosti, sestaví frontend (pokud chybí) a při prvním spuštění stáhne otevřená data (několik minut). Aplikace poběží na <http://127.0.0.1:8000>.

- `-Lan` / `--lan` zpřístupní aplikaci v místní síti (test na telefonu).
- `-Refresh` / `--refresh` znovu stáhne data.

Požadavky: Python 3.10+, Node.js 20+ (jen pro sestavení frontendu), volitelně [LM Studio](https://lmstudio.ai) s modelem `google/gemma-4-e4b` a `text-embedding-nomic-embed-text-v1.5`.

Cloudový model stačí zapnout klíčem: `GEMINI_API_KEY` v `.env` (nebo Nastavení → Modely AI) a poskytovatel se založí sám při startu. Router pak posílá složité dotazy do cloudu a jednoduché lokálnímu modelu; když ten druhý neodpoví, odpověď dokončí ten dostupný a aplikace uvede, který model odpovídal. Při politice dat *pouze lokálně* cloudový model neexistuje — dotaz se k němu nedostane ani na klasifikaci.

Bez modelu aplikace funguje: asistent pak odpovídá přímo z dat (bez jazykového modelu) a vyhledávání běží přes BM25.

## Co umí

- **Analytická vrstva** — živé profily 448 obcí, 15 ORP, okresů a kraje v devíti oblastech (demografie, doprava, školství, zdravotnictví, sociální oblast, bydlení, životní prostředí, kultura a cestovní ruch, veřejné finance). U každého ukazatele: poslední hodnota, rok, srovnání s krajem, zdroj a vyhodnocení *trend / jednorázový výkyv / stabilní* (Theil–Sen, Mann–Kendall, robustní z-skóre). Tvar grafu si vybírá ukazatel sám podle toho, co měří — podíl dostane ciferník, roční tok sloupce, stav plochu, jednorázový počet značky.
- **Rizika** — pravidla nad daty (stárnutí, úbytek, odliv, lékaři, kapacita ZŠ, nezaměstnanost, péče o seniory, kanalizace, rozpočet, výkyvy) s pěti stupni závažnosti, důvěrou a důkazy.
- **Výhled 2026–2040** — komponentní model ve třech scénářích s 90% pásmem a zpětným testem.
- **Simulátor „Co kdyby?“** — zásahy (byty, místa v ZŠ/MŠ, spoje, pracovní místa, lůžka, ordinace), srovnání bez zásahu / se zásahem, varování před přetížením kapacit, řetězec dopadů, editovatelné předpoklady, mezipaměť s předpočítáním častých scénářů.
- **Podněty občanů** — anonymizace, seskupování podobných hlášení, formální podnět pro kraj po dosažení prahu, nastavitelný cíl (KAM / webhook / e-mail).
- **Datové potřeby** — matice pokrytí ORP × oblast, čerstvost sad podle periodicity, strukturální mezery, proaktivní upozornění.
- **Mapa** — vlastní vektorová mapa Česka po krajích (počty otevřených dat, ukazatele) a Královéhradecka po obcích a ORP.
- **Asistent** — příkazy aplikace bez modelu („zapni tmavý režim“, „otevři mapu“), router lokální/cloud, hybridní RAG nad celým katalogem, citace zdrojů, ochrana proti jailbreaku a prompt injection.

## Data

Každá datová sada v katalogu má odkaz na zdroj a uvedené využití. Počet v aplikaci se počítá z databáze. Hlavní číslo zahrnuje jen sady, jejichž odkaz při poslední kontrole odpověděl (`check_status = ok`). Nefunkční odkazy a sady bez odkazu jsou v katalogu vidět zvlášť.

| Zdroj | Jak se používá |
|---|---|
| NKOD (SPARQL): všichni poskytovatelé, včetně Královéhradeckého kraje, ČSÚ, MF, DIA (IČ 17651921), MPSV, AOPK, ČÚZK, MMHK, NPÚ a CENIA | katalog, asistent, pokrytí, čerstvost, mapa |
| Krajské a městské portály (DCAT-AP, ArcGIS Hub): Data KHK, AOPK, ČHMÚ, IPR Praha, Brno, MSK, Pardubický, Liberecký, Karlovarský, Olomoucký a Ústecký kraj, Vysočina, Přerov, Chomutov, Most, Ústí n. L., Olomouc, Jihlava | katalog (duplicity s NKOD i mezi portály sloučeny) |
| Lokální katalogy OFN: opendata.mmhk.cz, opendata.praha.eu | katalog (duplicity sloučeny) |
| Národní geoportál INSPIRE (CENIA, CSW) | katalog |
| Czech POINT, NRPZS (ÚZIS) | katalog, API zdroje |
| ČSÚ: Městská a obecní statistika, roky 2005–2025 | hodnoty ukazatelů pro všechny obce |
| Data KHK přes ArcGIS REST — přes čtyřicet bodových vrstev (zastávky, lékaři, školy a školská zařízení, sociální služby, policie, hasiči, knihovny, muzea, kina, památky, infocentra, průmyslové zóny, inovativní firmy…) a vrstvy po obcích (kanalizace, pošta, územní plán, podíl exekucí, hospodářsky a sociálně ohrožené oblasti, výdaje rozpočtů 2018–2022, silnice, omezení dopravy) | hodnoty, zařízení a fakta v obcích |
| ČÚZK RÚIAN | hranice státu, krajů, ORP a obcí; přiřazení sad ke krajům |

Pravidla katalogu:
- Sady z NKOD se sklízejí po jmenovitých dávkách IRI, ne stránkováním přes výsledky. Metadatový dotaz vynechá sadu bez českého názvu, takže plná stránka může přijít neúplná — a pravidlo „krátká stránka = poslední stránka“ dřív sklizeň ukončilo asi po dvou pětinách každého poskytovatele.
- Duplicity se hledají dvakrát: shodou normalizovaného názvu v rámci kraje a shodou odkazu ke stažení. Index se staví znovu pro každý zdroj a vždy bez jeho vlastních řádků — portál porovnaný sám se sebou by si všechny své sady označil za duplicitní.
- Denní řezy jedné řady se slučují do jedné sady, pokud jich je aspoň 30. Příklad: denní soubory STK Ministerstva dopravy.
- Geoportál NPÚ vrací na vyhledávání HTTP 500, proto se přeskakuje. Jeho sady přicházejí přes NKOD.
- Web tshk.cz nepublikuje otevřená data.

Ruční aktualizace: `cd backend && python -m kam.ingest all` (kroky `geo`, `catalog`, `mos`, `khk`, `link`, `check`, `rag`). Kontrola jen nových sad: `python -m kam.ingest check-new`.

## Architektura

```
frontend/  React + TypeScript + Vite, vlastní CSS, SVG grafy a mapy, bez UI knihoven
backend/kam/
  ingest/     sklizeň NKOD, DCAT, ČSÚ MOS, Data KHK, ČÚZK
  analytics/  trendy, profily, rizika, výhled, simulace, datové potřeby
  ai/         poskytovatelé modelů, router, RAG, nástroje, ochrana, orchestrace
  api/        REST + SSE (dokumentace na /api/docs)
data/        SQLite databáze a geometrie (vzniká při ingestu)
```

Databáze: SQLite (výchozí) nebo PostgreSQL přes `DATABASE_URL`. Konfigurace v `.env` (viz `.env.example`).

## Nasazení

Postup, konfigurace a příkazy jsou v [DEPLOY.md](DEPLOY.md). Ve zkratce: aplikace
je jeden kontejner (`Dockerfile`), data leží v PostgreSQL (`DATABASE_URL`),
snímek se tam nahraje skriptem `scripts/migrate_to_postgres.py` a celý web
schová za heslo proměnná `KAM_AUTH_PASSWORD` (HTTP Basic, `/api/health`
zůstává otevřená kvůli health checku hostingu).

## Testy

```bash
python -m pytest
```

```bash
cd frontend && npm test
```
