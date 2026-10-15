"""Hybrid retrieval over everything KAM knows about.

Documents: every catalogue dataset, every indicator, every territory, and the
hand-written method/help texts. Two retrievers, fused with Reciprocal Rank
Fusion (k = 60):

- BM25 on unaccented tokens with a crude prefix stemmer (Czech inflects the
  end of the word, so the first six letters carry the lemma well enough —
  "nezaměstnanosti" and "nezaměstnanost" meet at "nezame");
- dense vectors from the local embedding model (nomic-embed-text), built in
  the background after startup. Until they exist, BM25 answers alone — the
  assistant never waits for an index.
"""

from __future__ import annotations

import math
import re
import threading
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass

import numpy as np
from sqlalchemy import delete, insert, select, update

from ..db import SessionLocal, session_scope
from ..indicators import DERIVED, PILLARS
from ..models import Dataset, Indicator, RagChunk, Territory
from ..territory import KRAJ_BY_CODE, LEVEL_LABEL
from .knowledge import DOCS

STOP = set("a aby ale ani az bez by byl byla bylo byt ci co do i jak jake jaky jaka je jeho jejich jen jsem jsou k kam kde kdo kdy ke ktera ktere ktery mezi mi mne na nad nebo neni o od po pod pro proc s se si sve ta tak take tato ten tento to tu u v ve vsak z za ze zda".split())
TOKEN = re.compile(r"[a-z0-9]+")


def plain(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower()


def tokens(text: str) -> list[str]:
    out = []
    for tok in TOKEN.findall(plain(text)):
        if tok in STOP or len(tok) < 2:
            continue
        out.append(tok[:6] if len(tok) > 6 else tok)
    return out


@dataclass
class Doc:
    idx: int
    doc_type: str
    doc_id: str
    title: str
    text: str
    url: str


class Index:
    def __init__(self) -> None:
        self.docs: list[Doc] = []
        self.postings: dict[str, list[tuple[int, int]]] = {}
        self.doc_len: list[int] = []
        self.avgdl = 1.0
        self.vectors: np.ndarray | None = None
        self.has_vec: np.ndarray | None = None
        self.row_ids: list[int] = []

    def build(self, rows: list[RagChunk]) -> None:
        self.docs = [Doc(i, r.doc_type, r.doc_id, r.title, r.text, r.url) for i, r in enumerate(rows)]
        self.row_ids = [r.id for r in rows]
        postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        lens = []
        for d in self.docs:
            toks = tokens(d.title + " " + d.title + " " + d.text)  # title counts twice
            lens.append(len(toks))
            for term, tf in Counter(toks).items():
                postings[term].append((d.idx, tf))
        self.postings = dict(postings)
        self.doc_len = lens
        self.avgdl = (sum(lens) / len(lens)) if lens else 1.0
        dims = 0
        for r in rows:
            if r.vector:
                dims = len(r.vector) // 4
                break
        if dims:
            mat = np.zeros((len(rows), dims), dtype=np.float32)
            has = np.zeros(len(rows), dtype=bool)
            for i, r in enumerate(rows):
                if r.vector and len(r.vector) == dims * 4:
                    v = np.frombuffer(r.vector, dtype=np.float32)
                    n = np.linalg.norm(v)
                    if n:
                        mat[i] = v / n
                        has[i] = True
            self.vectors, self.has_vec = mat, has
        else:
            self.vectors = self.has_vec = None

    def bm25(self, query: str, limit: int = 60, k1: float = 1.4, b: float = 0.72) -> list[tuple[int, float]]:
        scores: dict[int, float] = defaultdict(float)
        n = len(self.docs) or 1
        for term in set(tokens(query)):
            plist = self.postings.get(term)
            if not plist:
                continue
            idf = math.log(1 + (n - len(plist) + 0.5) / (len(plist) + 0.5))
            for idx, tf in plist:
                dl = self.doc_len[idx]
                scores[idx] += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / self.avgdl))
        return sorted(scores.items(), key=lambda kv: -kv[1])[:limit]

    def dense(self, qvec: list[float], limit: int = 60) -> list[tuple[int, float]]:
        if self.vectors is None:
            return []
        q = np.asarray(qvec, dtype=np.float32)
        q /= np.linalg.norm(q) or 1.0
        sims = self.vectors @ q
        sims[~self.has_vec] = -1.0
        top = np.argpartition(-sims, min(limit, len(sims) - 1))[:limit]
        return sorted(((int(i), float(sims[i])) for i in top if sims[i] > 0.25), key=lambda kv: -kv[1])

    @property
    def vector_coverage(self) -> float:
        if self.has_vec is None or not len(self.docs):
            return 0.0
        return float(self.has_vec.mean())


_index = Index()
_loaded = False
_lock = threading.Lock()


def _doc_texts() -> list[dict]:
    rows: list[dict] = []
    with SessionLocal() as s:
        for d in s.scalars(select(Dataset)):
            region = KRAJ_BY_CODE[d.region_code].name if d.region_code in KRAJ_BY_CODE else "celostátní"
            text = f"{d.description[:500]} Klíčová slova: {d.keywords.replace('|', ', ')[:300]}. Poskytovatel: {d.publisher}. Oblast: {PILLARS.get(d.pillar, 'ostatní')}. Územní rozsah: {region}. Formáty: {d.formats}."
            rows.append({"doc_type": "dataset", "doc_id": str(d.id), "title": d.title[:500], "text": text, "url": d.url})
        for i in s.scalars(select(Indicator)):
            rows.append({"doc_type": "indicator", "doc_id": i.code, "title": i.name,
                         "text": f"Ukazatel {i.name} ({i.unit}), oblast {PILLARS.get(i.pillar, i.pillar)}. Zdroj: {i.source_label}; původní producent: {i.origin}.", "url": i.source_url})
        for t in s.scalars(select(Territory)):
            parent = f", {t.parent_id}" if t.parent_id else ""
            rows.append({"doc_type": "territory", "doc_id": t.id, "title": t.name,
                         "text": f"{LEVEL_LABEL.get(t.level, t.level)} {t.name}{parent}. Počet obyvatel {t.population}.", "url": f"/obce/{t.id}"})
    for d in DERIVED:
        rows.append({"doc_type": "indicator", "doc_id": d.code, "title": d.name, "text": f"Odvozený ukazatel {d.name} ({d.unit}) = {d.explain}. Oblast {PILLARS.get(d.pillar)}.", "url": "/data#metodika"})
    for k in DOCS:
        rows.append({"doc_type": "method", "doc_id": k["id"], "title": k["title"], "text": k["text"], "url": k["url"]})
    return rows


def build_index(embed: bool = False) -> dict:
    """Rebuild chunk rows, keeping vectors for unchanged documents."""
    from ..ingest.common import job
    job("rag", "running", "Stavím index")
    rows = _doc_texts()
    with SessionLocal() as s:
        old = {(r.doc_type, r.doc_id): (r.title, r.text, r.vector) for r in s.scalars(select(RagChunk))}
    for r in rows:
        prev = old.get((r["doc_type"], r["doc_id"]))
        r["vector"] = prev[2] if prev and prev[0] == r["title"] and prev[1] == r["text"] else None
    with session_scope() as s:
        s.execute(delete(RagChunk))
        for i in range(0, len(rows), 4000):
            s.execute(insert(RagChunk), rows[i:i + 4000])
    reload()
    stats = {"docs": len(rows)}
    if embed:
        stats["embedded"] = embed_pending()
    job("rag", "done", str(stats), 1.0)
    return stats


def embed_pending(batch: int = 64, max_docs: int | None = None) -> int:
    from ..ingest.common import job
    from .providers import embed
    with SessionLocal() as s:
        pending = s.execute(select(RagChunk.id, RagChunk.title, RagChunk.text).where(RagChunk.vector.is_(None))).all()
    if max_docs:
        pending = pending[:max_docs]
    done = 0
    for i in range(0, len(pending), batch):
        chunk = pending[i:i + batch]
        try:
            vecs = embed([f"search_document: {t}. {x[:700]}" for _, t, x in chunk])
        except Exception as e:
            job("rag", "error", f"Embedding nedostupný: {e}", done / max(len(pending), 1))
            break
        with session_scope() as s:
            for (rid, _, _), v in zip(chunk, vecs, strict=True):
                s.execute(update(RagChunk).where(RagChunk.id == rid).values(vector=np.asarray(v, dtype=np.float32).tobytes()))
        done += len(chunk)
        if (i // batch) % 10 == 0:
            job("rag", "running", f"Vektory {done}/{len(pending)}", done / max(len(pending), 1))
    reload()
    return done


def reload() -> None:
    global _loaded
    with SessionLocal() as s:
        rows = list(s.scalars(select(RagChunk).order_by(RagChunk.id)))
    idx = Index()
    idx.build(rows)
    with _lock:
        global _index
        _index = idx
        _loaded = True


def index() -> Index:
    if not _loaded:
        reload()
    return _index


def search(query: str, k: int = 8, types: tuple[str, ...] | None = None, use_vectors: bool = True, embed_timeout: float = 1.5) -> list[dict]:
    from .providers import pick
    if use_vectors and pick("local") is None:
        use_vectors = False  # vektor dotazu by počítal lokální server, který nemáme: hledá se jen BM25
    idx = index()
    lex = idx.bm25(query)
    dense: list[tuple[int, float]] = []
    if use_vectors and idx.vector_coverage > 0.5:
        try:
            from .providers import embed
            dense = idx.dense(embed([f"search_query: {query}"], timeout=embed_timeout)[0])
        except Exception:
            dense = []
    fused: dict[int, float] = defaultdict(float)
    for rank, (i, _) in enumerate(lex):
        fused[i] += 1 / (60 + rank)
    for rank, (i, _) in enumerate(dense):
        fused[i] += 1 / (60 + rank)
    out = []
    for i, score in sorted(fused.items(), key=lambda kv: -kv[1]):
        d = idx.docs[i]
        if types and d.doc_type not in types:
            continue
        out.append({"type": d.doc_type, "id": d.doc_id, "title": d.title, "snippet": d.text[:260], "url": d.url, "score": round(score, 5)})
        if len(out) >= k:
            break
    return out


def stats() -> dict:
    idx = index()
    return {"docs": len(idx.docs), "vector_coverage": round(idx.vector_coverage, 3), "terms": len(idx.postings)}
