"""Persistent model.

Facts and inferences live in different tables on purpose: `Observation` holds
only values a publisher measured or published (with the dataset they came
from), while forecasts and scenario outputs are computed on read or stored in
`Scenario.result` with their assumptions. A scenario never writes back into
`Observation` — reality is not editable from a what-if.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now() -> datetime:
    return datetime.now(UTC)


class Source(Base):
    """A place we harvest from: an NKOD publisher, a DCAT feed, an API, a file."""

    __tablename__ = "source"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    publisher: Mapped[str] = mapped_column(String(255), default="")
    ico: Mapped[str] = mapped_column(String(16), default="")
    kind: Mapped[str] = mapped_column(String(32))  # nkod | dcat | api | file
    url: Mapped[str] = mapped_column(Text, default="")
    portal_url: Mapped[str] = mapped_column(Text, default="")
    license: Mapped[str] = mapped_column(String(255), default="")
    group: Mapped[str] = mapped_column(String(32), default="core")  # core | kraje
    dataset_count: Mapped[int] = mapped_column(Integer, default=0)
    last_harvest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")


class Dataset(Base):
    __tablename__ = "dataset"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ext_id: Mapped[str] = mapped_column(String(512), unique=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    publisher: Mapped[str] = mapped_column(String(255), default="")
    publisher_ico: Mapped[str] = mapped_column(String(16), default="")
    url: Mapped[str] = mapped_column(Text, default="")  # human page (NKOD / portal)
    alt_url: Mapped[str] = mapped_column(Text, default="")  # second portal carrying the same dataset
    download_url: Mapped[str] = mapped_column(Text, default="")
    landing_url: Mapped[str] = mapped_column(Text, default="")  # publisher's own page for the dataset
    # Link check (ingest/check.py): ok | chyba | bez_odkazu | neovereno
    check_status: Mapped[str] = mapped_column(String(16), default="neovereno", index=True)
    check_code: Mapped[int] = mapped_column(Integer, default=0)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    formats: Mapped[str] = mapped_column(String(255), default="")
    keywords: Mapped[str] = mapped_column(Text, default="")
    themes: Mapped[str] = mapped_column(String(255), default="")
    pillar: Mapped[str] = mapped_column(String(32), default="ostatni", index=True)
    region_code: Mapped[int] = mapped_column(Integer, default=0, index=True)  # RÚIAN kraj code, 0 = national
    periodicity: Mapped[str] = mapped_column(String(32), default="")
    modified: Mapped[str] = mapped_column(String(32), default="")
    freshness: Mapped[str] = mapped_column(String(16), default="neznama")  # aktualni | zastarala | neznama
    loaded: Mapped[bool] = mapped_column(Boolean, default=False)  # values ingested into the model
    usage: Mapped[list] = mapped_column(JSON, default=list)
    harvested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_dataset_source", "source_id"),)


class Territory(Base):
    __tablename__ = "territory"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # obec:574040
    level: Mapped[str] = mapped_column(String(8), index=True)
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(255), index=True)
    name_norm: Mapped[str] = mapped_column(String(255), default="")
    parent_id: Mapped[str] = mapped_column(String(32), default="")
    orp_id: Mapped[str] = mapped_column(String(32), default="")
    okres_id: Mapped[str] = mapped_column(String(32), default="")
    kraj_code: Mapped[int] = mapped_column(Integer, default=0, index=True)
    population: Mapped[int] = mapped_column(Integer, default=0)
    lon: Mapped[float] = mapped_column(Float, default=0.0)
    lat: Mapped[float] = mapped_column(Float, default=0.0)
    # IČO úřadu z ARES. Je to klíč do registrů, které obce nezveřejňují samy:
    # rozpočet v MONITORu, smlouvy v registru smluv, zakázky ve věstníku.
    # Přidáno později, takže má výchozí hodnotu — `_ensure_columns` ho doplní.
    ico: Mapped[str] = mapped_column(String(16), default="")
    # ID datové schránky z registru OVM (RPP). Jediná adresa úřadu, kterou
    # stát vede sám a garantuje — vlastní web obce v žádném registru není.
    ds: Mapped[str] = mapped_column(String(16), default="")


class Indicator(Base):
    __tablename__ = "indicator"
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(32), default="")
    pillar: Mapped[str] = mapped_column(String(32), index=True)
    polarity: Mapped[int] = mapped_column(Integer, default=0)
    agg: Mapped[str] = mapped_column(String(32), default="sum")
    source_label: Mapped[str] = mapped_column(String(255), default="")
    origin: Mapped[str] = mapped_column(String(255), default="")  # original producer, e.g. ÚZIS
    source_url: Mapped[str] = mapped_column(Text, default="")
    dataset_ext_id: Mapped[str] = mapped_column(String(512), default="")


class Observation(Base):
    __tablename__ = "observation"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    territory_id: Mapped[str] = mapped_column(String(32))
    indicator_code: Mapped[str] = mapped_column(String(32))
    year: Mapped[int] = mapped_column(Integer)
    value: Mapped[float] = mapped_column(Float)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (
        UniqueConstraint("territory_id", "indicator_code", "year", name="uq_obs"),
        Index("ix_obs_ind_year", "indicator_code", "year"),
    )


class Fact(Base):
    """Non-numeric per-territory attributes (e.g. sewerage status text)."""

    __tablename__ = "fact"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    territory_id: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(Text, default="")
    as_of: Mapped[str] = mapped_column(String(32), default="")

    __table_args__ = (UniqueConstraint("territory_id", "key", name="uq_fact"),)


class Poi(Base):
    __tablename__ = "poi"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(Text)
    obec_code: Mapped[str] = mapped_column(String(16), index=True, default="")
    orp_code: Mapped[str] = mapped_column(String(16), default="")
    lon: Mapped[float] = mapped_column(Float, default=0.0)
    lat: Mapped[float] = mapped_column(Float, default=0.0)
    attrs: Mapped[dict] = mapped_column(JSON, default=dict)
    source_url: Mapped[str] = mapped_column(Text, default="")


class Event(Base):
    __tablename__ = "event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    detail: Mapped[str] = mapped_column(Text, default="")
    territory_id: Mapped[str] = mapped_column(String(32), default="")
    starts: Mapped[str] = mapped_column(String(32), default="")
    ends: Mapped[str] = mapped_column(String(32), default="")
    source_url: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[str] = mapped_column(String(32), default="")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Scenario(Base):
    __tablename__ = "scenario"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    territory_id: Mapped[str] = mapped_column(String(32))
    interventions: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SimStat(Base):
    """Query-pattern memory for the simulation cache (layer 2)."""

    __tablename__ = "sim_stat"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    territory_id: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    last_hit: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Cluster(Base):
    __tablename__ = "cluster"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    territory_id: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    terms: Mapped[list] = mapped_column(JSON, default=list)
    count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="sber")  # sber | pripraveno | odeslano
    reference: Mapped[str] = mapped_column(String(32), default="")
    submission: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Report(Base):
    __tablename__ = "report"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    territory_id: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16), default="problem")  # problem | chybejici_data
    text: Mapped[str] = mapped_column(Text)
    cluster_id: Mapped[int | None] = mapped_column(ForeignKey("cluster.id"), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ChatSession(Base):
    __tablename__ = "chat_session"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), default="Nová konverzace")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ChatMessage(Base):
    __tablename__ = "chat_message"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_session.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ModelProvider(Base):
    __tablename__ = "model_provider"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32))  # openai | gemini
    base_url: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(255))
    api_key_enc: Mapped[str] = mapped_column(Text, default="")
    tier: Mapped[str] = mapped_column(String(16), default="local")  # local | cloud
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_tokens: Mapped[int] = mapped_column(Integer, default=900)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AppSetting(Base):
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


class RagChunk(Base):
    __tablename__ = "rag_chunk"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_type: Mapped[str] = mapped_column(String(16), index=True)  # dataset | indicator | territory | method | page
    doc_id: Mapped[str] = mapped_column(String(512))
    title: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text, default="")
    vector: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    __table_args__ = (UniqueConstraint("doc_type", "doc_id", name="uq_rag_doc"),)


class AuditLog(Base):
    """Provozní log. Zapisuje se do něj jediným místem — `logs.zapis`.

    `level` a `source` přibyly později; `_ensure_columns` je umí doplnit do
    starého snímku, proto mají výchozí hodnotu a starší řádky zůstanou
    platné jako `info` / `system`.
    """

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    level: Mapped[str] = mapped_column(String(16), default="info")
    source: Mapped[str] = mapped_column(String(24), default="system")


class Dokument(Base):
    """Povinně zveřejňovaný dokument obce — co si obec sama naplánovala.

    Drží se tu **záznam o dokumentu**, ne jeho obsah: název, období, ke kterému
    se váže, kdy byl zveřejněn a kam vede. Co z plánu je hotové, nikdo strojově
    nezveřejňuje, takže se to tady ani netvrdí — stav se počítá z období a data
    zveřejnění a znamená přesně tolik, kolik na to stačí: jestli dokument
    v daném roce ještě platí.

    `zdroj_url` je povinná část řádku, ne ozdoba. Údaj o cizím dokumentu bez
    cesty k originálu je tvrzení z druhé ruky.
    """

    __tablename__ = "dokument"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uzemi_id: Mapped[str] = mapped_column(String(32), index=True)
    druh: Mapped[str] = mapped_column(String(32), index=True)  # pro | rozpocet | …
    nazev: Mapped[str] = mapped_column(String(500))
    od: Mapped[int] = mapped_column(Integer, default=0)  # první rok období, 0 = neuvedeno
    do: Mapped[int] = mapped_column(Integer, default=0)  # poslední rok období
    publikovano: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    url: Mapped[str] = mapped_column(Text, default="")        # samotný dokument
    zdroj: Mapped[str] = mapped_column(String(32), default="")  # obcepro | …
    zdroj_id: Mapped[str] = mapped_column(String(32), default="")
    zdroj_url: Mapped[str] = mapped_column(Text, default="")   # záznam v registru
    zdroj_nazev: Mapped[str] = mapped_column(String(255), default="")
    #: `platny` | `archiv` — u územně plánovací dokumentace je archivace
    #: jediná informace o tom, že dokument nahradil jiný. Prázdné tam, kde
    #: to zdroj neříká; nedopočítává se.
    stav: Mapped[str] = mapped_column(String(16), default="")
    harvested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class JobState(Base):
    __tablename__ = "job_state"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="idle")
    detail: Mapped[str] = mapped_column(Text, default="")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
