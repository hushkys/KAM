# Otevřené API KAM

Jedno místo, odkud si stáhnete data, která KAM posbíral z otevřených zdrojů —
naměřené hodnoty, území, zařízení i katalog sad. **Bez klíče, bez registrace,
bez omezení počtu dotazů.**

Základ: `https://hack-a-ton-hushkys.web.app/api/v1`
Vlastní instance: `http://localhost:8000/api/v1`

Volat jde i přímo z prohlížeče na cizí stránce — hlavička `Access-Control-Allow-Origin: *`
je na `/api/v1` schválně. Zbytek `/api` obsluhuje samotnou aplikaci a tu hlavičku nemá.

---

## Začněte tady

```bash
curl https://hack-a-ton-hushkys.web.app/api/v1
```

Rozcestník vypíše, co API nabízí, kolik toho je a jak se ptát. Není to jen
uvítání: `cesty` a `priklady` v odpovědi jsou funkční adresy, takže se s API dá
začít pracovat, aniž byste četli zbytek tohoto souboru.

---

## Cesty

| Cesta | Co vrací | Parametry |
|---|---|---|
| `/api/v1` | Rozcestník s počty a příklady | — |
| `/api/v1/hodnoty` | **Naměřené hodnoty** | `ukazatel`, `uzemi`, `uroven`, `od`, `do`, `limit`, `offset`, `format` |
| `/api/v1/ukazatele` | Registr ukazatelů | `oblast`, `hledat`, `format` |
| `/api/v1/uzemi` | Obce, ORP, okresy, kraj | `uroven`, `hledat`, `format` |
| `/api/v1/fakta` | Nečíselné údaje o území | `uzemi`, `klic`, `format` |
| `/api/v1/zarizeni` | Zastávky, školy, ordinace | `druh`, `obec`, `format` |
| `/api/v1/katalog` | Datové sady i s odkazy na originál | `hledat`, `oblast`, `poskytovatel`, `jen_funkcni`, `limit`, `offset`, `format` |
| `/api/v1/zdroje` | Odkud se sklízí a kdy naposledy | `format` |

Strojově čitelný popis všech parametrů je na `/api/docs` (OpenAPI).

---

## Hodnoty: jádro celého API

Jeden řádek je jedno číslo — území, ukazatel, rok, hodnota:

```json
{
  "uzemi": "obec:569810",
  "uzemi_nazev": "Hradec Králové",
  "uroven": "obec",
  "kod_ruian": "569810",
  "ukazatel": "110900",
  "ukazatel_nazev": "Počet obyvatel k 31. 12.",
  "jednotka": "osob",
  "rok": 2025,
  "hodnota": 93534.0,
  "puvodce": "ČSÚ"
}
```

**Nic se tu nedopočítává.** Podíly, poměry a přepočty na tisíc obyvatel si
aplikace počítá až při čtení a do databáze je nikdy nezapisuje, takže tady
najdete jen to, co někdo doopravdy zveřejnil. `puvodce` je skutečný původce,
ne jen ten, kdo data přeposlal — ČSÚ MOS republikuje čísla jiných úřadů
a v tom rozdílu se dá snadno ztratit.

Příklady:

```bash
# Počet obyvatel všech obcí od roku 2020
curl "…/api/v1/hodnoty?ukazatel=110900&uroven=obec&od=2020"

# Všechno, co model ví o jedné obci
curl "…/api/v1/hodnoty?uzemi=obec:569810"

# Víc ukazatelů i území najednou — oddělujte čárkou
curl "…/api/v1/hodnoty?ukazatel=110900,110930&uzemi=obec:569810,obec:573868"
```

---

## Formáty

| `format` | K čemu | Chování |
|---|---|---|
| `json` (výchozí) | Programy, ladění | Stránkuje, v odpovědi je `celkem` a `dalsi` |
| `csv` | Tabulkový procesor | Streamuje, bez stropu, s BOM kvůli Excelu |
| `ndjson` | Velké dávky, roury | Streamuje, řádek = jeden záznam |

JSON stránkuje po `limit` položkách (výchozí 1 000, nejvýš 50 000) a v odpovědi
posílá `dalsi` s adresou další stránky. CSV a NDJSON strop nemají a posílají se
proudem, takže jimi projde i celá databáze, aniž by se cokoli načetlo do paměti.

```bash
# Celá historie počtu obyvatel jako CSV
curl -o obyvatele.csv "…/api/v1/hodnoty?ukazatel=110900&format=csv"

# Dávka po řádcích rovnou do jq
curl -s "…/api/v1/hodnoty?uroven=okres&format=ndjson" | jq -r '.hodnota'
```

---

## Klient do příkazové řádky

Ve zdrojovém kódu je [`scripts/kam.py`](../scripts/kam.py) — klient, který si
vystačí se standardní knihovnou Pythonu. Stačí ho zkopírovat a spustit; nástroj,
kvůli kterému si musí úřad nejdřív něco nainstalovat, se nepoužije.

```bash
python kam.py info                                   # co API nabízí
python kam.py ukazatele --hledat lékař               # najít ukazatel
python kam.py uzemi --uroven orp                     # seznam ORP
python kam.py data --ukazatel 110900 --uzemi obec:569810
python kam.py katalog --hledat doprava
python kam.py stahni hodnoty --format csv --do-souboru vse.csv
```

Ukazuje se zarovnaná tabulka, protože většina dotazů končí tím, že se člověk
podívá. `--json` vypíše surovou odpověď, `--csv` pošle CSV na standardní výstup
a `stahni` zapisuje proud rovnou do souboru.

Proti vlastní instanci: `--server http://localhost:8000`.

---

## Jak si najít, na co se ptát

1. `…/api/v1/ukazatele?hledat=lékař` — najde kód ukazatele
2. `…/api/v1/uzemi?hledat=Náchod` — najde `id` území
3. `…/api/v1/hodnoty?ukazatel=<kód>&uzemi=<id>` — vrátí čísla

`id` území má tvar `uroven:kód`, kde kód je RÚIAN (`obec:569810`). Právě proto
se dají data napojit na jiné registry, které týmiž kódy klíčují.

`polarita` u ukazatele říká, jestli je vyšší hodnota lepší (`1`), horší (`-1`),
nebo to tak říct nejde (`0`). Bez ní se z čísla nedá dělat závěr — což je věc,
kterou většina otevřených dat neuvádí a kvůli které se pak špatně interpretují.

---

## Licence a slušnost

Kód aplikace je MIT. **Data se řídí licencí původního zdroje**, která je uvedená
u každé sady v katalogu (`/api/v1/katalog`) — KAM data nevlastní, jen je sesbíral
a propojil.

Rate limit tu žádný není. Kdybyste plánovali stahovat opravdu hodně, použijte
`format=csv` nebo `ndjson` a jeden velký dotaz místo tisíců malých; je to
rychlejší pro vás i šetrnější k serveru.

---

## Co API **nevrací**

Aby bylo jasné, kde končí data a začíná interpretace:

- **Výhledy a simulace.** Počítají se až při čtení a nikdy se neukládají, takže
  to nejsou data, ale model. Najdete je v aplikaci, ne tady.
- **Podněty občanů.** Jsou to signály k ověření, ne fakta, a do `Observation` se
  nikdy nepropisují.
- **Cokoli osobního.** V datech nejsou žádné osobní údaje; podněty se anonymizují
  už při zápisu a do API se nedostanou vůbec.
