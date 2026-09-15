// Podněty: citizens report a problem or missing data; similar reports cluster
// and, past the threshold, become a formal submission for the regional office.
// Layout: a form that stays at hand on the left, a working list on the right,
// and anything ready to hand over pulled to the top of that list.

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { PodnetyHook } from "../components/PodnetyHook";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Empty, Modal, Pill, Segmented } from "../components/ui";
import { api, invalidate, useApi } from "../lib/api";
import { date, fold, num, plural } from "../lib/format";
import { useLocation } from "../lib/router";
import { toast } from "../lib/toast";

interface Cluster { id: number; territory: { id: string; name: string }; category: string; category_label: string; title: string; count: number; status: string; reference: string; updated_at: string; created_at: string; channel: string | null }
interface Doc extends Cluster { addressee: string; body: string; reports: { id: number; text: string; kind: string; created_at: string }[]; context: { name: string; value: number; unit: string; year: number; trend: string }[]; note: string; generated_at: string }
interface Stats { reports: number; clusters: number; by_status: Record<string, number>; missing_data_reports: number; threshold: number }

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" }> = {
  sber: { label: "Sbírají se hlášení", tone: "neutral" }, pripraveno: { label: "Připraveno k předání", tone: "warn" }, odeslano: { label: "Předáno kraji", tone: "ok" },
};

export function Reports() {
  const { query } = useLocation();
  const cats = useApi<Record<string, string>>("/reports/categories");
  const clusters = useApi<Cluster[]>("/reports/clusters");
  const stats = useApi<Stats>("/reports/stats");
  const [tid, setTid] = useState<string | null>(query.get("t"));
  const [kind, setKind] = useState(query.get("kind") === "chybejici_data" ? "chybejici_data" : "problem");
  const [cat, setCat] = useState("doprava");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const form = useRef<HTMLElement>(null);
  const threshold = stats.data?.threshold ?? 5;

  const refresh = () => { invalidate("/reports"); clusters.reload(); stats.reload(); };
  const list = useMemo(() => {
    const f = fold(q.trim());
    return (clusters.data ?? []).filter((c) => (!status || c.status === status) && (!f || fold(`${c.title} ${c.territory.name} ${c.category_label}`).includes(f)));
  }, [clusters.data, q, status]);
  const ready = (clusters.data ?? []).filter((c) => c.status === "pripraveno");

  const submit = async () => {
    if (!tid) { toast("warn", "Vyberte obec."); return; }
    setSending(true);
    try {
      const r = await api<{ joined: boolean; status: string; became_ready: boolean }>("/reports", { body: { territory: tid, category: cat, text, kind } });
      setText("");
      toast("ok", r.became_ready ? "Podnět dosáhl prahu a je připraven k předání kraji." : r.joined ? "Díky. Přidali jsme vás k podobným hlášením." : "Díky. Podnět je zaznamenán.");
      refresh();
    } catch (e) { toast("error", (e as Error).message); }
    finally { setSending(false); }
  };
  const openDoc = async (id: number) => { try { setDoc(await api<Doc>(`/reports/clusters/${id}`)); } catch (e) { toast("error", (e as Error).message); } };
  const deliver = async (id: number) => {
    try {
      const r = await api<{ channel: string; mailto?: string; reference: string }>(`/reports/clusters/${id}/submit`, { method: "POST" });
      if (r.channel === "email" && r.mailto && doc) window.location.href = `mailto:${r.mailto}?subject=${encodeURIComponent(`Podnět ${r.reference}`)}&body=${encodeURIComponent(doc.body)}`;
      toast("ok", `Podnět ${r.reference} předán (${{ local: "uložen v KAM", webhook: "odeslán webhookem", email: "připraven v e-mailu" }[r.channel] ?? r.channel}).`);
      setDoc(null);
      refresh();
    } catch (e) { toast("error", (e as Error).message); }
  };
  const same = (c: Cluster) => { setTid(c.territory.id); setCat(c.category); setDoc(null); form.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const kpis = [
    { icon: "message", label: "Hlášení celkem", value: stats.data?.reports ?? 0 },
    { icon: "layers", label: "Skupiny podnětů", value: stats.data?.clusters ?? 0 },
    { icon: "alert", label: "Připraveno k předání", value: stats.data?.by_status.pripraveno ?? 0 },
    { icon: "check", label: "Předáno kraji", value: stats.data?.by_status.odeslano ?? 0 },
  ];

  return (
    <>
      <PodnetyHook skupiny={clusters.data ?? []} prah={threshold} hlaseni={stats.data?.reports}>
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => form.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><Icon name="plus" size={16} /> Nový podnět</button>
        </div>
      </PodnetyHook>

      <div className="rp-kpis">
        {kpis.map((k, i) => (
          <div className="rp-kpi reveal" key={k.label} style={{ "--i": i } as CSSProperties}>
            <span className="rp-kpi-icon"><Icon name={k.icon} size={18} /></span>
            <span className="rp-kpi-text"><span className="rp-kpi-value num">{num(k.value)}</span><span className="rp-kpi-label">{k.label}</span></span>
          </div>
        ))}
      </div>

      <div className="rp-layout">
        <section className="rp-form card reveal" ref={form} aria-labelledby="rp-form-title" style={{ "--i": 1 } as CSSProperties}>
          <h2 id="rp-form-title" className="card-title"><Icon name="message" size={17} /> <span>Nový podnět</span></h2>
          <ol className="rp-steps">
            <li>
              <span className="rp-step-no">1</span>
              <div className="rp-step-body"><TerritoryPicker value={tid} onChange={(id) => setTid(id)} label="Obec" levels={["obec"]} /></div>
            </li>
            <li>
              <span className="rp-step-no">2</span>
              <div className="rp-step-body field"><span className="field-label">Co hlásíte</span>
                <Segmented label="Typ podnětu" value={kind} onChange={setKind} options={[{ value: "problem", label: "Problém v obci" }, { value: "chybejici_data", label: "Chybějící data" }]} />
              </div>
            </li>
            <li>
              <span className="rp-step-no">3</span>
              <div className="rp-step-body field"><span className="field-label">Oblast</span>
                <div className="rp-cats" role="radiogroup" aria-label="Oblast">
                  {Object.entries(cats.data ?? {}).map(([k, v]) => (
                    <button key={k} type="button" role="radio" aria-checked={cat === k} className={`rp-cat ${cat === k ? "is-on" : ""}`} onClick={() => setCat(k)}>
                      <Icon name={PILLAR_ICON[k] ?? "info"} size={16} /><span>{v}</span>
                    </button>
                  ))}
                </div>
              </div>
            </li>
            <li>
              <span className="rp-step-no">4</span>
              <label className="rp-step-body field"><span className="field-label">Popis</span>
                <textarea className="textarea" value={text} maxLength={1000} rows={4} onChange={(e) => setText(e.target.value)}
                  placeholder={kind === "problem" ? "Např. večer nejede žádný spoj do Hradce Králové…" : "Např. chybí data o kapacitě domů s pečovatelskou službou…"} />
                <span className="rp-count"><span>{text.length < 10 ? "Alespoň 10 znaků" : "Osobní údaje se automaticky skryjí"}</span><span className="num">{text.length}/1000</span></span>
              </label>
            </li>
          </ol>
          <button className="btn btn-primary btn-lg btn-block" disabled={sending || text.trim().length < 10 || !tid} onClick={submit}><Icon name="send" size={16} /> {sending ? "Odesílám…" : "Odeslat podnět"}</button>
          <p className="disclaimer" style={{ marginTop: 12 }}><Icon name="shield" size={13} /><span>Podnět je anonymní a nezapočítává se jako fakt do dat modelu — slouží jako signál k ověření.</span></p>
        </section>

        <div className="rp-main">
          {ready.length > 0 && (
            <section className="rp-ready reveal" style={{ "--i": 2 } as CSSProperties} aria-label="Připraveno k předání">
              <div className="rp-ready-head"><Icon name="alert" size={17} /><strong>Připraveno k předání kraji</strong><span className="mute small">{ready.length} {plural(ready.length, "podnět", "podněty", "podnětů")}</span></div>
              {ready.map((c) => (
                <button className="rp-ready-row" key={c.id} onClick={() => openDoc(c.id)}>
                  <span className="ellipsis"><strong>{c.title}</strong> <span className="mute">· {c.territory.name}</span></span>
                  <span className="rp-ready-cta">Zobrazit podnět <Icon name="arrow-right" size={14} /></span>
                </button>
              ))}
            </section>
          )}

          <div className="rp-toolbar reveal" style={{ "--i": 3 } as CSSProperties}>
            <div className="input-icon rp-search"><Icon name="search" size={16} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat v podnětech…" aria-label="Hledat v podnětech" enterKeyHint="search" /></div>
            <Segmented size="sm" label="Stav" value={status} onChange={setStatus} options={[{ value: "", label: "Vše" }, { value: "sber", label: "Sbírá se" }, { value: "pripraveno", label: "Připraveno" }, { value: "odeslano", label: "Předáno" }]} />
          </div>

          <div className="rp-list">
            {clusters.data && list.length === 0 && <Empty icon="message" title={clusters.data.length ? "Nic neodpovídá filtru" : "Zatím žádné podněty"}>{clusters.data.length ? "Zkuste jiný stav nebo hledaný výraz." : "První hlášení se objeví tady."}</Empty>}
            {list.map((c, i) => (
              <button className="rp-item reveal" key={c.id} onClick={() => openDoc(c.id)} style={{ "--i": Math.min(i, 10) } as CSSProperties} data-ctx={c.territory.id} data-ctx-label={c.territory.name}>
                <span className={`rp-item-icon cat-${c.category}`}><Icon name={PILLAR_ICON[c.category] ?? "info"} size={18} /></span>
                <span className="rp-item-body">
                  <span className="rp-item-title">{c.title}</span>
                  <span className="rp-item-meta">{c.territory.name} · {c.category_label} · {date(c.updated_at)}{c.reference ? ` · ${c.reference}` : ""}</span>
                  <span className="rp-item-progress">
                    <span className="rp-bar"><span style={{ width: `${Math.min(100, (100 * c.count) / threshold)}%` }} className={c.count >= threshold ? "is-full" : ""} /></span>
                    <span className="xsmall num">{c.count} / {threshold} {plural(c.count, "hlášení", "hlášení", "hlášení")}</span>
                  </span>
                </span>
                <span className="rp-item-side"><Pill tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label}</Pill><Icon name="chevron-right" size={16} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Modal open={Boolean(doc)} onClose={() => setDoc(null)} title={doc ? (doc.status === "sber" ? "Skupina hlášení" : "Formální podnět") : ""} wide
        footer={doc ? <>
          {doc.status === "sber" && <button className="btn" onClick={() => same(doc)}><Icon name="plus" size={16} /> Mám stejný problém</button>}
          {doc.status !== "sber" && <button className="btn" onClick={() => window.print()}><Icon name="print" size={16} /> Tisk / PDF</button>}
          {doc.status === "pripraveno" && <button className="btn btn-primary" onClick={() => deliver(doc.id)}><Icon name="send" size={16} /> Předat kraji</button>}
        </> : undefined}>
        {doc && (
          <article className="rp-letter">
            <dl className="rp-letter-head">
              {doc.status !== "sber" && <><dt>Adresát</dt><dd>{doc.addressee}</dd></>}
              <dt>Věc</dt><dd>{doc.title}</dd>
              <dt>Území a oblast</dt><dd>{doc.territory.name} · {doc.category_label}</dd>
              {doc.reference && <><dt>Značka</dt><dd className="num">{doc.reference}</dd></>}
              <dt>Stav</dt><dd><Pill tone={STATUS[doc.status]?.tone}>{STATUS[doc.status]?.label}</Pill> <span className="mute small">{doc.count} {plural(doc.count, "hlášení", "hlášení", "hlášení")}</span></dd>
            </dl>
            {doc.status !== "sber" && <div className="rp-letter-body">{doc.body}</div>}
            {doc.context.length > 0 && (
              <div className="table-wrap"><table className="table"><thead><tr><th>Související data území</th><th className="r">Hodnota</th><th>Vývoj</th></tr></thead>
                <tbody>{doc.context.map((c) => <tr key={c.name}><td>{c.name}</td><td className="r">{num(c.value)} {c.unit} ({c.year})</td><td>{c.trend}</td></tr>)}</tbody></table></div>
            )}
            <div className="rp-timeline">
              <strong className="small">Anonymizovaná hlášení</strong>
              {doc.reports.map((r) => (
                <div className="rp-tl-item" key={r.id}><span className="rp-tl-dot" /><div><p className="small">{r.text}</p><span className="xsmall mute">{date(r.created_at)}{r.kind === "chybejici_data" ? " · chybějící data" : ""}</span></div></div>
              ))}
            </div>
            <p className="xsmall mute">{doc.note}</p>
          </article>
        )}
      </Modal>
    </>
  );
}
