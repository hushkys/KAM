"""`python -m kam.ingest [geo|relief|catalog|eurostat|mos|khk|dotace|dokumenty|link|rag|all]`

Each step is idempotent and can be re-run on its own; `all` runs them in
dependency order. The resulting SQLite file is the offline snapshot the demo
runs from when there is no network.
"""

from __future__ import annotations

import logging
import sys
import time

from ..db import init_db


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    steps = argv or ["all"]
    if steps == ["all"]:
        steps = ["geo", "relief", "catalog", "eurostat", "mos", "khk", "dotace", "dokumenty", "link", "check", "rag"]
    init_db()
    for step in steps:
        t = time.time()
        if step == "geo":
            from .geo import build
            print("geo", build())
        elif step == "relief":
            from .relief import build as relief_build
            print("relief", relief_build())
        elif step == "catalog":
            from .catalog import harvest
            print("catalog", harvest())
        elif step == "eurostat":
            from .eurostat import harvest as eurostat_harvest
            print("eurostat", eurostat_harvest())
        elif step == "mos":
            from .mos import ingest
            print("mos", ingest())
        elif step == "khk":
            from .khk import ingest
            print("khk", ingest())
        elif step == "dotace":
            from .dotace import ingest as dotace_ingest
            print("dotace", dotace_ingest())
        elif step == "dokumenty":
            from .dokumenty import ingest as dokumenty_ingest
            print("dokumenty", dokumenty_ingest())
        elif step == "link":
            from .link import link
            print("link", link())
        elif step == "check":
            from .check import check
            print("check", check())
        elif step == "check-new":
            from .check import check
            print("check-new", check(only_unchecked=True))
        elif step == "admin":
            from .geo import extend_admin
            print("admin", extend_admin())
        elif step == "rag":
            from ..ai.rag import build_index
            print("rag", build_index(embed=True))
        else:
            print(f"Neznámý krok: {step}")
            return 2
        print(f"  {step}: {time.time() - t:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
