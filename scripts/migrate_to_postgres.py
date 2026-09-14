"""Copy the local SQLite snapshot into PostgreSQL.

    python scripts/migrate_to_postgres.py "postgresql+psycopg://user:pass@host/db?sslmode=require"

A hosted KAM cannot carry `data/kam.db` — it is ~190 MB and a container's disk
does not survive a deploy. The schema is dialect-neutral (see `kam.db`), so the
move is a straight table-by-table copy: create the schema on the target, then
stream every row of every table in dependency order.

Idempotent by truncation: each table is emptied before it is filled, so running
this again after a fresh harvest replaces the hosted snapshot rather than
doubling it. Nothing is read from the target, so it never overwrites the local
database by accident — the source is always SQLite, the target always the URL
given on the command line.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

BATCH = 5000


def main(argv: list[str]) -> int:
    if not argv or not argv[0].startswith("postgres"):
        print(__doc__)
        return 2
    target_url = argv[0]

    from sqlalchemy import create_engine, delete, insert, select

    from kam.config import settings
    from kam.db import Base
    from kam import models  # noqa: F401  (registers the tables on Base)

    source_url = f"sqlite:///{(settings.data_dir / 'kam.db').as_posix()}"
    if not (settings.data_dir / "kam.db").is_file():
        print(f"Zdrojová databáze neexistuje: {settings.data_dir / 'kam.db'}")
        print("Nejdřív spusťte: cd backend && python -m kam.ingest all")
        return 1

    source = create_engine(source_url, future=True)
    target = create_engine(target_url, future=True, pool_pre_ping=True)

    print(f"zdroj : {source_url}")
    print(f"cíl   : {target_url.split('@')[-1]}")  # never echo the password
    Base.metadata.create_all(target)

    total = 0
    for table in Base.metadata.sorted_tables:
        t0 = time.time()
        with source.connect() as src:
            rows = [dict(r) for r in src.execute(select(table)).mappings()]
        with target.begin() as dst:
            dst.execute(delete(table))
            for i in range(0, len(rows), BATCH):
                chunk = rows[i:i + BATCH]
                if chunk:
                    dst.execute(insert(table), chunk)
        total += len(rows)
        print(f"  {table.name:<16} {len(rows):>8} řádků  {time.time() - t0:5.1f} s")

    # PostgreSQL sequences do not know about ids inserted with explicit values,
    # so the next insert would collide with an existing row.
    from sqlalchemy import text
    with target.begin() as dst:
        for table in Base.metadata.sorted_tables:
            for col in table.columns:
                if col.autoincrement is True and col.primary_key:
                    dst.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', '{col.name}'), "
                        f"COALESCE((SELECT MAX({col.name}) FROM {table.name}), 1), true)"))
    print(f"hotovo: {total} řádků")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
