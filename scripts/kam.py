#!/usr/bin/env python3
"""kam — klient otevřeného API aplikace KAM.

    python scripts/kam.py info
    python scripts/kam.py ukazatele --hledat lékař
    python scripts/kam.py uzemi --uroven orp
    python scripts/kam.py data --ukazatel 110900 --uzemi obec:569810
    python scripts/kam.py katalog --hledat doprava
    python scripts/kam.py stahni hodnoty --ukazatel 110900 --do-souboru obyvatele.csv

Jediná závislost je standardní knihovna Pythonu. Je to schválně: nástroj,
kvůli kterému si musí úřad nejdřív něco nainstalovat, se nepoužije. Tenhle
soubor stačí zkopírovat a spustit.

Ukazuje se tabulka, ne JSON, protože většina dotazů končí tím, že se člověk
podívá. Kdo chce data dál zpracovat, přidá `--json` nebo `--csv`; stahování
větších dávek má vlastní příkaz `stahni`, který proud rovnou zapisuje do
souboru a nedrží ho v paměti.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request

SERVER = "https://hack-a-ton-hushkys.web.app"
CAS = 120


def _url(server: str, cesta: str, parametry: dict) -> str:
    q = {k: v for k, v in parametry.items() if v not in (None, "", False)}
    return f"{server.rstrip('/')}/api/v1{cesta}" + (f"?{urllib.parse.urlencode(q)}" if q else "")


def _zavolej(server: str, cesta: str, parametry: dict) -> dict:
    adresa = _url(server, cesta, parametry)
    try:
        with urllib.request.urlopen(adresa, timeout=CAS) as o:
            return json.load(o)
    except urllib.error.HTTPError as e:
        telo = e.read().decode("utf-8", "replace")
        try:
            telo = json.loads(telo).get("detail", telo)
        except ValueError:
            pass
        _konec(f"Server odpověděl {e.code}: {telo}")
    except urllib.error.URLError as e:
        _konec(f"Server {server} neodpovídá ({e.reason}). Jiný přidáte přes --server.")
    return {}


def _konec(zprava: str) -> None:
    print(f"Chyba: {zprava}", file=sys.stderr)
    raise SystemExit(1)


def _tabulka(radky: list[dict], sloupce: list[str]) -> None:
    """Zarovnaná tabulka, oříznutá na šířku terminálu. Poslední sloupec se
    zkracuje jako první — bývá to popis, kterého je nejmíň škoda."""
    if not radky:
        print("(nic neodpovídá)")
        return
    sirka_okna = shutil.get_terminal_size((120, 25)).columns
    sirky = [max(len(s), *(len(str(r.get(s, ""))) for r in radky)) for s in sloupce]
    while sum(sirky) + 2 * len(sirky) > sirka_okna and max(sirky) > 8:
        sirky[sirky.index(max(sirky))] -= 1

    def rada(hodnoty) -> str:
        kusy = []
        for h, s in zip(hodnoty, sirky):
            t = str(h)
            kusy.append((t[: s - 1] + "…") if len(t) > s else t.ljust(s))
        return "  ".join(kusy).rstrip()

    print(rada(sloupce))
    print(rada(["─" * s for s in sirky]))
    for r in radky:
        print(rada([r.get(s, "") for s in sloupce]))


def _vypis(data: dict, sloupce: list[str], args) -> None:
    polozky = data.get("polozky", [])
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    if args.csv:
        import csv

        w = csv.DictWriter(sys.stdout, fieldnames=sloupce, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(polozky)
        return
    _tabulka(polozky, sloupce)
    celkem = data.get("celkem")
    if celkem is not None and celkem > len(polozky):
        print(f"\nZobrazeno {len(polozky)} z {celkem}. Další: --limit / --offset, "
              f"celou dávku stáhnete příkazem `stahni`.")
    elif celkem is not None:
        print(f"\nCelkem {celkem}.")


# ------------------------------------------------------------------ příkazy
def prikaz_info(args) -> None:
    d = _zavolej(args.server, "", {})
    r = d["rozsah"]
    print(f"{d['nazev']} — verze {d['verze']}\n")
    print(d["popis"] + "\n")
    print(f"  kraj        {r['kraj']}")
    print(f"  roky        {r['roky'][0]}–{r['roky'][1]}" if r.get("roky") else "")
    for k in ("hodnoty", "ukazatele", "uzemi", "zarizeni", "fakta", "katalog", "dokumenty"):
        print(f"  {k:<11} {r.get(k, 0):,}".replace(",", " "))
    print("\nCesty:")
    for jmeno, adresa in d["cesty"].items():
        print(f"  {jmeno:<11} {adresa}")
    print("\nPříklady:")
    for p in d["priklady"]:
        print(f"  {p}")


def prikaz_ukazatele(args) -> None:
    d = _zavolej(args.server, "/ukazatele", {"hledat": args.hledat, "oblast": args.oblast})
    _vypis(d, ["kod", "nazev", "jednotka", "oblast", "hodnot", "puvodce"], args)


def prikaz_uzemi(args) -> None:
    d = _zavolej(args.server, "/uzemi", {"uroven": args.uroven, "hledat": args.hledat})
    _vypis(d, ["id", "nazev", "uroven", "kod_ruian", "obyvatel", "ico"], args)


def prikaz_data(args) -> None:
    d = _zavolej(args.server, "/hodnoty", {
        "ukazatel": args.ukazatel, "uzemi": args.uzemi, "uroven": args.uroven,
        "od": args.od, "do": args.do, "limit": args.limit, "offset": args.offset})
    _vypis(d, ["uzemi_nazev", "ukazatel", "ukazatel_nazev", "rok", "hodnota", "jednotka"], args)


def prikaz_fakta(args) -> None:
    d = _zavolej(args.server, "/fakta", {"uzemi": args.uzemi, "klic": args.klic})
    _vypis(d, ["uzemi_nazev", "klic", "hodnota", "platnost"], args)


def prikaz_zarizeni(args) -> None:
    d = _zavolej(args.server, "/zarizeni", {"druh": args.druh, "obec": args.obec})
    _vypis(d, ["druh", "nazev", "obec_kod", "lon", "lat"], args)


def prikaz_katalog(args) -> None:
    d = _zavolej(args.server, "/katalog", {
        "hledat": args.hledat, "oblast": args.oblast, "poskytovatel": args.poskytovatel,
        "limit": args.limit, "offset": args.offset})
    _vypis(d, ["nazev", "poskytovatel", "oblast", "formaty", "nacteno_do_modelu"], args)


def prikaz_dokumenty(args) -> None:
    d = _zavolej(args.server, "/dokumenty", {
        "uzemi": args.uzemi, "druh": args.druh, "stav": args.stav, "od": args.od, "do": args.do})
    _vypis(d, ["uzemi_nazev", "druh", "nazev", "od", "do", "stav", "odkaz"], args)


def prikaz_zdroje(args) -> None:
    d = _zavolej(args.server, "/zdroje", {})
    _vypis(d, ["nazev", "druh", "sad", "funkcnich", "sklizeno"], args)


def prikaz_stahni(args) -> None:
    """Stáhne celou dávku proudem rovnou do souboru.

    Nepoužívá `_zavolej`: odpověď může mít desítky megabajtů a načíst ji celou
    do paměti kvůli tomu, aby se hned zapsala na disk, je zbytečné."""
    cesty = {"hodnoty": "/hodnoty", "ukazatele": "/ukazatele", "uzemi": "/uzemi",
             "katalog": "/katalog", "zarizeni": "/zarizeni", "fakta": "/fakta",
             "dokumenty": "/dokumenty", "zdroje": "/zdroje"}
    if args.co not in cesty:
        _konec(f"Neznámá sada '{args.co}'. Na výběr je: {', '.join(cesty)}.")
    adresa = _url(args.server, cesty[args.co], {
        "format": args.format, "ukazatel": args.ukazatel, "uzemi": args.uzemi,
        "uroven": args.uroven, "od": args.od, "do": args.do, "hledat": args.hledat})
    cil = args.do_souboru or f"kam-{args.co}.{args.format}"
    print(f"Stahuji {adresa}", file=sys.stderr)
    try:
        with urllib.request.urlopen(adresa, timeout=CAS) as o, open(cil, "wb") as f:
            bajtu = 0
            while kus := o.read(65536):
                f.write(kus)
                bajtu += len(kus)
                print(f"\r  {bajtu / 1_048_576:.1f} MB", end="", file=sys.stderr)
    except urllib.error.URLError as e:
        _konec(f"Stažení selhalo: {e}")
    print(f"\rHotovo: {cil} ({bajtu / 1_048_576:.1f} MB)", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="kam", description="Klient otevřeného API aplikace KAM.",
        epilog="Bez --server míří na veřejné nasazení; vlastní instanci zadáte "
               "např. --server http://localhost:8000")
    p.add_argument("--server", default=SERVER, help=f"adresa serveru (výchozí {SERVER})")
    p.add_argument("--json", action="store_true", help="vypsat surovou odpověď")
    p.add_argument("--csv", action="store_true", help="vypsat jako CSV na standardní výstup")
    pod = p.add_subparsers(dest="prikaz", required=True)

    pod.add_parser("info", help="co API nabízí a kolik toho je").set_defaults(fn=prikaz_info)

    a = pod.add_parser("ukazatele", help="registr ukazatelů")
    a.add_argument("--hledat", default="")
    a.add_argument("--oblast", default="", help="demografie, doprava, skolstvi…")
    a.set_defaults(fn=prikaz_ukazatele)

    a = pod.add_parser("uzemi", help="obce, ORP, okresy, kraj")
    a.add_argument("--uroven", default="", help="obec | orp | okres | kraj")
    a.add_argument("--hledat", default="")
    a.set_defaults(fn=prikaz_uzemi)

    a = pod.add_parser("data", help="naměřené hodnoty")
    a.add_argument("--ukazatel", default="", help="kód, víc oddělte čárkou")
    a.add_argument("--uzemi", default="", help="ID území, víc oddělte čárkou")
    a.add_argument("--uroven", default="")
    a.add_argument("--od", type=int)
    a.add_argument("--do", type=int)
    a.add_argument("--limit", type=int, default=50)
    a.add_argument("--offset", type=int, default=0)
    a.set_defaults(fn=prikaz_data)

    a = pod.add_parser("fakta", help="nečíselné údaje o území")
    a.add_argument("--uzemi", default="")
    a.add_argument("--klic", default="")
    a.set_defaults(fn=prikaz_fakta)

    a = pod.add_parser("zarizeni", help="zastávky, školy, ordinace")
    a.add_argument("--druh", default="")
    a.add_argument("--obec", default="")
    a.set_defaults(fn=prikaz_zarizeni)

    a = pod.add_parser("katalog", help="datové sady, ze kterých KAM čerpá")
    a.add_argument("--hledat", default="")
    a.add_argument("--oblast", default="")
    a.add_argument("--poskytovatel", default="")
    a.add_argument("--limit", type=int, default=30)
    a.add_argument("--offset", type=int, default=0)
    a.set_defaults(fn=prikaz_katalog)

    a = pod.add_parser("dokumenty", help="programy rozvoje a územní plány obcí")
    a.add_argument("--uzemi", default="", help="obec:579432 (lze i více oddělených čárkou)")
    a.add_argument("--druh", default="", help="pro | upd")
    a.add_argument("--stav", default="", help="platny | archiv (jen u územních plánů)")
    a.add_argument("--od", type=int, default=0, help="období platnosti od roku")
    a.add_argument("--do", type=int, default=0, help="období platnosti do roku")
    a.set_defaults(fn=prikaz_dokumenty)

    pod.add_parser("zdroje", help="odkud se sklízí").set_defaults(fn=prikaz_zdroje)

    a = pod.add_parser("stahni", help="stáhnout celou sadu do souboru")
    a.add_argument("co", help="hodnoty | ukazatele | uzemi | katalog | zarizeni | fakta | dokumenty | zdroje")
    a.add_argument("--format", default="csv", choices=("csv", "ndjson", "json"))
    a.add_argument("--do-souboru", dest="do_souboru", default="")
    a.add_argument("--ukazatel", default="")
    a.add_argument("--uzemi", default="")
    a.add_argument("--uroven", default="")
    a.add_argument("--od", type=int)
    a.add_argument("--do", type=int)
    a.add_argument("--hledat", default="")
    a.set_defaults(fn=prikaz_stahni)

    args = p.parse_args(argv)
    # Windowsová konzole jinak spadne na první diakritice ve jménu obce.
    for proud in (sys.stdout, sys.stderr):
        if hasattr(proud, "reconfigure"):
            proud.reconfigure(encoding="utf-8", errors="replace")
    args.fn(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
