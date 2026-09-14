import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { Icon } from "../components/Icon";
import { useTerritories } from "../components/TerritoryPicker";
import { Empty, PageHeader, Segmented } from "../components/ui";
import { fold, num, plural } from "../lib/format";
import { navigate, setQuery, useLocation } from "../lib/router";

export function Territories() {
  const { query } = useLocation();
  const { data, loading } = useTerritories();
  const [q, setQ] = useState(query.get("q") ?? "");
  const level = query.get("level") ?? "obec";
  const sort = query.get("sort") ?? "pop";
  const [limit, setLimit] = useState(60);
  const rows = useMemo(() => {
    const f = fold(q.trim());
    const r = (data ?? []).filter((t) => t.level === level && (!f || fold(t.name).includes(f)));
    r.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "cs") : b.population - a.population));
    return r;
  }, [data, q, level, sort]);

  const open = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(`/obce/${id}`);
  };

  return (
    <>
      <PageHeader eyebrow="Živé profily" title="Obce a správní obvody" lead="Každé území má profil ve všech sledovaných oblastech, rizika, výhled a zdroje. Vyhledávat lze i bez diakritiky." />
      <div className="terr-toolbar">
        <div className="input-icon">
          <Icon name="search" size={17} />
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} placeholder="Hledat území, např. Jaroměř…" aria-label="Hledat území" />
        </div>
        <Segmented label="Úroveň" value={level} onChange={(v) => { setQuery({ level: v === "obec" ? null : v }); setLimit(60); }}
          options={[{ value: "obec", label: "Obce" }, { value: "orp", label: "ORP" }, { value: "okres", label: "Okresy" }, { value: "kraj", label: "Kraj" }]} />
        <Segmented label="Řazení" size="sm" value={sort} onChange={(v) => setQuery({ sort: v === "pop" ? null : v })} options={[{ value: "pop", label: "Podle velikosti" }, { value: "name", label: "Podle názvu" }]} />
      </div>
      <p className="small mute" style={{ marginBottom: 12 }} aria-live="polite">{loading ? "Načítám…" : `${num(rows.length)} ${plural(rows.length, "území", "území", "území")}`}</p>
      {!loading && rows.length === 0 && <Empty icon="search" title="Nic nenalezeno">Zkuste jiný název nebo úroveň.</Empty>}
      <div className="terr-grid">
        {rows.slice(0, limit).map((t, i) => (
          <a key={t.id} href={`/obce/${t.id}`} onClick={(e) => open(e, t.id)} className="terr-card reveal" style={{ "--i": Math.min(i, 14) } as CSSProperties} data-ctx={t.id} data-ctx-label={t.name}>
            <span className="tc-name">{t.name}</span>
            <span className="tc-meta"><span>{t.level_label}{t.parent && t.level === "obec" ? ` · ${t.parent}` : ""}</span><span className="num">{num(t.population)} obyv.</span></span>
          </a>
        ))}
      </div>
      {rows.length > limit && <div className="row" style={{ justifyContent: "center", marginTop: 18 }}><button className="btn" onClick={() => setLimit((l) => l + 90)}>Zobrazit další ({num(rows.length - limit)})</button></div>}
    </>
  );
}
