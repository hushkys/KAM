// Settings: appearance and accessibility live in the browser (per person);
// models, routing and data destinations live on the server (they decide what
// leaves the machine).

import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { Card, Empty, Modal, PageHeader, Pill, Segmented, Switch } from "../components/ui";
import { api, invalidate, useApi } from "../lib/api";
import { num } from "../lib/format";
import { DEFAULTS, reset, set as setPrefs, usePrefs } from "../lib/prefs";
import { jeNainstalovana, lzeVyzvat, nabidniInstalaci, potrebaIosNavod, sledujInstalaci } from "../lib/pwa";
import { Link } from "../lib/router";
import { toast } from "../lib/toast";

const TABS = [
  { key: "vzhled", label: "Vzhled", icon: "sun" },
  { key: "pristupnost", label: "Přístupnost", icon: "eye" },
  { key: "modely", label: "Modely AI", icon: "sparkle" },
  { key: "soukromi", label: "Data a soukromí", icon: "shield" },
  { key: "aplikace", label: "O aplikaci", icon: "info" },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="setting-row"><span className="sr-text"><span className="sr-label">{label}</span>{hint && <span className="sr-hint">{hint}</span>}</span>{children}</div>;
}

function Appearance() {
  const p = usePrefs();
  return (
    <div className="stack-y">
      <Card i={0} title="Motiv" icon="sun">
        <div className="theme-cards">
          {(["system", "light", "dark"] as const).map((t) => (
            <button key={t} className={`theme-card ${p.theme === t ? "is-on" : ""}`} aria-pressed={p.theme === t} onClick={() => setPrefs({ theme: t })}>
              <span className={`theme-prev ${t}`}><i /><b /></span>
              {{ system: "Podle systému", light: "Světlý", dark: "Tmavý" }[t]}
            </button>
          ))}
        </div>
      </Card>
      <Card i={1} title="Rozložení a efekty" icon="layers" className="setting-block">
        <Switch checked={p.transparency} onChange={(v) => setPrefs({ transparency: v })} label="Efekty průhlednosti" hint="Navigace a panely jako matné sklo. Vypnutím se zrychlí vykreslování na slabších zařízeních." />
        <Row label="Hustota" hint="Mezery mezi prvky.">
          <Segmented label="Hustota" value={p.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: "comfortable", label: "Vzdušná" }, { value: "compact", label: "Kompaktní" }]} />
        </Row>
        <Row label="Umístění navigace" hint="Na telefonu je navigace vždy dole.">
          <Segmented label="Umístění navigace" value={p.dock} onChange={(v) => setPrefs({ dock: v })} options={[{ value: "bottom", label: "Dole", icon: "dock" }, { value: "side", label: "Po straně", icon: "sidebar" }]} />
        </Row>
        <Switch checked={p.dockLabels} onChange={(v) => setPrefs({ dockLabels: v })} label="Popisky v navigaci" />
        <div className="row" style={{ marginTop: 12 }}><button className="btn btn-quiet btn-sm" onClick={() => { reset(); toast("ok", "Vzhled obnoven na výchozí."); }}><Icon name="refresh" size={15} /> Obnovit výchozí</button></div>
      </Card>
    </div>
  );
}

function Accessibility() {
  const p = usePrefs();
  return (
    <div className="stack-y">
      <Card i={0} title="Čitelnost" icon="text">
        <Row label="Velikost písma" hint={`${Math.round(p.fontScale * 100)} % — ovlivní celou aplikaci.`}>
          <div className="row" style={{ minWidth: 240, flexWrap: "nowrap" }}>
            <button className="icon-btn sm" aria-label="Zmenšit písmo" onClick={() => setPrefs({ fontScale: p.fontScale - 0.05 })}><Icon name="minus" size={16} /></button>
            <input type="range" min={0.85} max={1.3} step={0.05} value={p.fontScale} aria-label="Velikost písma" onChange={(e) => setPrefs({ fontScale: Number(e.target.value) })}
              style={{ "--p": `${((p.fontScale - 0.85) / 0.45) * 100}%` } as CSSProperties} />
            <button className="icon-btn sm" aria-label="Zvětšit písmo" onClick={() => setPrefs({ fontScale: p.fontScale + 0.05 })}><Icon name="plus" size={16} /></button>
          </div>
        </Row>
        <Switch checked={p.contrast === "high"} onChange={(v) => setPrefs({ contrast: v ? "high" : "normal" })} label="Vysoký kontrast" hint="Tmavší text a výraznější okraje." />
        <Switch checked={p.underlineLinks} onChange={(v) => setPrefs({ underlineLinks: v })} label="Podtrhávat odkazy" />
        <Switch checked={p.focusRing} onChange={(v) => setPrefs({ focusRing: v })} label="Výrazný rámeček fokusu" hint="Pro ovládání klávesnicí." />
      </Card>
      <Card i={1} title="Pohyb" icon="motion" className="setting-block">
        <Switch checked={p.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} label="Omezit animace" hint="Vypne přechody mezi stránkami a animace vstupu. Respektuje i nastavení systému." />
      </Card>
      <Card i={2} title="Klávesové zkratky" icon="keyboard" className="setting-block">
        {[["Hledat", "Ctrl + K nebo /"], ["Asistent", "Ctrl + J"], ["Zavřít okno / menu", "Esc"], ["Kontextové menu prohlížeče", "Shift + pravé tlačítko"], ["Pohyb v nabídkách", "↑ ↓ Enter"]].map(([a, k]) => (
          <div className="kbd-row" key={a}><span>{a}</span><kbd>{k}</kbd></div>
        ))}
      </Card>
    </div>
  );
}

interface Provider { id: number; name: string; kind: "openai" | "gemini"; base_url: string; model: string; tier: "local" | "cloud"; enabled: boolean; is_default: boolean; temperature: number; max_tokens: number; has_key: boolean; key_hint: string }
interface Settings { ai: { policy: string; router_mode: string; history: boolean; retention_days: number; max_sources: number; answer_length: string }; destinations: { reports_target: string; webhook_url: string; email: string; threshold: number; auto_submit: boolean }; data: { auto_refresh: boolean; refresh_hours: number } }

const EMPTY: Omit<Provider, "id" | "has_key" | "key_hint"> & { api_key: string } = { name: "", kind: "openai", base_url: "http://localhost:1234/v1", model: "", tier: "local", enabled: true, is_default: false, temperature: 0.2, max_tokens: 900, api_key: "" };

async function saveSection(section: string, values: Record<string, unknown>) {
  try {
    await api(`/settings/${section}`, { method: "PUT", body: values });
    invalidate("/settings");
    toast("ok", "Uloženo.");
  } catch (e) { toast("error", (e as Error).message); }
}

function Models() {
  const list = useApi<Provider[]>("/ai/providers");
  const st = useApi<Settings>("/settings");
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [tests, setTests] = useState<Record<number, { ok: boolean; ms: number; error: string; sample?: string; reply_ms?: number; models?: string[] } | "busy">>({});
  const [probe, setProbe] = useState("");
  const [route, setRoute] = useState<{ intent: string; tier: string; reason: string; complexity: string } | null>(null);
  const reload = () => { invalidate("/ai/providers"); list.reload(); };
  const test = async (p: Provider) => {
    setTests((t) => ({ ...t, [p.id]: "busy" }));
    try { const r = await api<{ ok: boolean; ms: number; error: string; sample?: string }>(`/ai/providers/${p.id}/test`, { method: "POST", timeout: 90000 }); setTests((t) => ({ ...t, [p.id]: r })); }
    catch (e) { setTests((t) => ({ ...t, [p.id]: { ok: false, ms: 0, error: (e as Error).message } })); }
  };
  const save = async () => {
    if (!edit) return;
    const body = { ...edit, api_key: edit.api_key === "" && edit.id ? null : edit.api_key };
    try {
      await api(edit.id ? `/ai/providers/${edit.id}` : "/ai/providers", { method: edit.id ? "PUT" : "POST", body });
      setEdit(null); reload(); toast("ok", "Model uložen.");
    } catch (e) { toast("error", (e as Error).message); }
  };
  const remove = async (p: Provider) => {
    if (!confirm(`Odebrat model „${p.name}“?`)) return;
    await api(`/ai/providers/${p.id}`, { method: "DELETE" }); reload();
  };
  const ai = st.data?.ai;
  return (
    <div className="stack-y">
      <Card i={0} title="Modely" icon="sparkle" actions={<button className="btn btn-sm btn-primary" onClick={() => setEdit({ ...EMPTY })}><Icon name="plus" size={15} /> Přidat model</button>}>
        {list.data?.length === 0 && <Empty title="Žádný model" />}
        {list.data?.map((p) => {
          const t = tests[p.id];
          return (
            <div className="provider" key={p.id}>
              <span className="provider-icon"><Icon name={p.tier === "cloud" ? "globe" : "monitor"} /></span>
              <span className="provider-name">{p.name}<Pill tone={p.tier === "cloud" ? "info" : "accent"}>{p.tier === "cloud" ? "Cloud" : "Lokální"}</Pill>{p.is_default && <Pill>výchozí</Pill>}{!p.enabled && <Pill tone="warn">vypnuto</Pill>}</span>
              <span className="provider-actions">
                <button className="btn btn-sm btn-quiet" onClick={() => test(p)} disabled={t === "busy"}>{t === "busy" ? "Testuji…" : "Otestovat"}</button>
                <button className="icon-btn sm" aria-label="Upravit" onClick={() => setEdit({ ...p, api_key: "" })}><Icon name="settings" size={16} /></button>
                <button className="icon-btn sm" aria-label="Odebrat" onClick={() => remove(p)}><Icon name="trash" size={16} /></button>
              </span>
              <span className="provider-sub">
                {p.model} · {p.kind === "gemini" ? "Google Gemini API" : p.base_url}{p.kind === "gemini" && !p.has_key ? " · chybí API klíč" : p.has_key ? ` · klíč ${p.key_hint}` : ""}
                {t && t !== "busy" && <span style={{ color: t.ok ? "var(--ok)" : "var(--bad)" }}> · {t.ok ? `funguje (${num(t.reply_ms ?? t.ms)} ms)${t.sample ? `: „${t.sample}“` : ""}` : t.error}</span>}
              </span>
            </div>
          );
        })}
      </Card>
      {ai && (
        <Card i={1} title="Směrování dotazů" icon="split" className="setting-block">
          <Row label="Kam smí dotazy" hint="Lokálně = nic neopouští tento počítač. Hybridně = složité analýzy jdou na cloudový model, pokud je nastaven.">
            <Segmented label="Politika" value={ai.policy} onChange={(v) => saveSection("ai", { policy: v }).then(st.reload)} options={[{ value: "local_only", label: "Jen lokálně" }, { value: "hybrid", label: "Hybridně" }, { value: "cloud_preferred", label: "Cloud" }]} />
          </Row>
          <Row label="Router" hint="Heuristika rozhodne okamžitě; model upřesní rozhodnutí krátkým dotazem na cloudový model.">
            <Segmented label="Router" value={ai.router_mode} onChange={(v) => saveSection("ai", { router_mode: v }).then(st.reload)} options={[{ value: "heuristic", label: "Heuristika" }, { value: "model", label: "Model" }]} />
          </Row>
          <Row label="Délka odpovědí">
            <Segmented label="Délka" value={ai.answer_length} onChange={(v) => saveSection("ai", { answer_length: v }).then(st.reload)} options={[{ value: "kratka", label: "Krátké" }, { value: "stredni", label: "Střední" }, { value: "podrobna", label: "Podrobné" }]} />
          </Row>
          <div className="setting-row">
            <span className="sr-text"><span className="sr-label">Vyzkoušet router</span><span className="sr-hint">Jak by byl dotaz zpracován.</span></span>
            <form className="row" style={{ flex: "1 1 320px", flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); if (probe.trim()) setRoute(await api("/ai/route", { body: { message: probe } })); }}>
              <input className="input" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Např. porovnej Broumov a Jičín a doporuč zásah" />
              <button className="btn btn-sm" type="submit">Zkusit</button>
            </form>
          </div>
          {route && <p className="small"><Pill tone="accent">{route.intent}</Pill> <Pill>{route.complexity}</Pill> <Pill tone={route.tier === "cloud" ? "info" : "ok"}>{route.tier === "cloud" ? "cloud" : "lokální"}</Pill> <span className="muted">{route.reason}</span></p>}
        </Card>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Upravit model" : "Přidat model"}
        footer={<><button className="btn btn-quiet" onClick={() => setEdit(null)}>Zrušit</button><button className="btn btn-primary" onClick={save} disabled={!edit?.name || !edit?.model}>Uložit</button></>}>
        {edit && (
          <div className="form-grid">
            <label className="field full"><span className="field-label">Název</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Např. Gemma 4 (LM Studio)" /></label>
            <label className="field"><span className="field-label">Typ API</span>
              <select className="select" value={edit.kind} onChange={(e) => { const kind = e.target.value as Provider["kind"]; setEdit({ ...edit, kind, base_url: kind === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : edit.base_url, tier: kind === "gemini" ? "cloud" : edit.tier }); }}>
                <option value="openai">OpenAI-kompatibilní (LM Studio, Ollama, vLLM, OpenAI…)</option><option value="gemini">Google Gemini</option>
              </select></label>
            <label className="field"><span className="field-label">Umístění</span>
              <select className="select" value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: e.target.value as Provider["tier"] })}><option value="local">Lokální</option><option value="cloud">Cloud</option></select></label>
            <label className="field full"><span className="field-label">Adresa serveru</span><input className="input" value={edit.base_url} onChange={(e) => setEdit({ ...edit, base_url: e.target.value })} /></label>
            <label className="field full"><span className="field-label">Model</span><input className="input" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} placeholder={edit.kind === "gemini" ? "gemini-2.5-flash" : "google/gemma-4-e4b"} /></label>
            <label className="field full"><span className="field-label">API klíč {edit.id ? "(prázdné = beze změny)" : ""}</span><input className="input" type="password" autoComplete="off" value={edit.api_key} onChange={(e) => setEdit({ ...edit, api_key: e.target.value })} placeholder={edit.kind === "gemini" ? "Klíč z Google AI Studia" : "Lokální servery klíč nepotřebují"} />
              <span className="help">Klíč se ukládá šifrovaně na serveru a do prohlížeče se už nevrací.</span></label>
            <label className="field"><span className="field-label">Teplota {edit.temperature}</span><input type="range" min={0} max={1.2} step={0.05} value={edit.temperature} onChange={(e) => setEdit({ ...edit, temperature: Number(e.target.value) })} style={{ "--p": `${(edit.temperature / 1.2) * 100}%` } as CSSProperties} /></label>
            <label className="field"><span className="field-label">Max. tokenů</span><input className="input" type="number" min={64} max={8192} value={edit.max_tokens} onChange={(e) => setEdit({ ...edit, max_tokens: Number(e.target.value) })} /></label>
            <div className="full"><Switch checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Povolen" /><Switch checked={edit.is_default} onChange={(v) => setEdit({ ...edit, is_default: v })} label="Výchozí pro své umístění" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Privacy() {
  const st = useApi<Settings>("/settings");
  const [dest, setDest] = useState<Settings["destinations"] | null>(null);
  const s = st.data;
  const d = dest ?? s?.destinations;
  if (!s || !d) return <span className="skeleton" style={{ height: 300, width: "100%" }} />;
  const clearHistory = async () => {
    const rows = await api<{ id: string }[]>("/chat/sessions");
    await Promise.all(rows.map((r) => api(`/chat/sessions/${r.id}`, { method: "DELETE" })));
    toast("ok", `Smazáno ${rows.length} konverzací.`);
  };
  return (
    <div className="stack-y">
      <Card i={0} title="Co opouští tento počítač" icon="shield">
        <div className="facts-list">
          <div className="fact-row"><span>Dotazy na asistenta</span><span>{{ local_only: "zůstávají lokálně", hybrid: "složité mohou jít na cloudový model", cloud_preferred: "jdou na cloudový model" }[s.ai.policy]}</span></div>
          <div className="fact-row"><span>Podněty občanů</span><span>{{ local: "zůstávají v databázi KAM", webhook: "odesílají se na nastavený webhook", email: "předávají se e-mailem" }[d.reports_target]}</span></div>
          <div className="fact-row"><span>Stahování dat</span><span>jen z veřejných katalogů (NKOD, ČSÚ, ČÚZK, Data KHK)</span></div>
          <div className="fact-row"><span>Analytika, sledování, cookies</span><span>žádné</span></div>
        </div>
      </Card>
      <Card i={1} title="Asistent" icon="sparkle" className="setting-block">
        <Row label="Kam smí dotazy">
          <Segmented label="Politika dat" value={s.ai.policy} onChange={(v) => saveSection("ai", { policy: v }).then(st.reload)} options={[{ value: "local_only", label: "Jen lokálně" }, { value: "hybrid", label: "Hybridně" }, { value: "cloud_preferred", label: "Cloud" }]} />
        </Row>
        <Switch checked={s.ai.history} onChange={(v) => saveSection("ai", { history: v }).then(st.reload)} label="Ukládat historii konverzací" hint="Osobní údaje v dotazech se před uložením maskují." />
        <Row label="Doba uchování" hint="Starší konverzace se automaticky mažou.">
          <select className="select" style={{ width: "auto" }} value={s.ai.retention_days} onChange={(e) => saveSection("ai", { retention_days: Number(e.target.value) }).then(st.reload)}>
            {[1, 7, 30, 90, 365].map((d) => <option key={d} value={d}>{d} {d === 1 ? "den" : d < 5 ? "dny" : "dní"}</option>)}
          </select>
        </Row>
        <div className="row" style={{ marginTop: 10 }}><button className="btn btn-sm btn-danger" onClick={clearHistory}><Icon name="trash" size={15} /> Smazat historii konverzací</button></div>
      </Card>
      <Card i={2} title="Předávání podnětů kraji" icon="send" className="setting-block">
        <Row label="Cíl" hint="Kam se odešle formální podnět po dosažení prahu.">
          <Segmented label="Cíl" value={d.reports_target} onChange={(v) => setDest({ ...d, reports_target: v })} options={[{ value: "local", label: "Jen KAM" }, { value: "webhook", label: "Webhook" }, { value: "email", label: "E-mail" }]} />
        </Row>
        {d.reports_target === "webhook" && <label className="field" style={{ marginTop: 10 }}><span className="field-label">Adresa webhooku (https)</span><input className="input" value={d.webhook_url} onChange={(e) => setDest({ ...d, webhook_url: e.target.value })} placeholder="https://…" /></label>}
        {d.reports_target === "email" && <label className="field" style={{ marginTop: 10 }}><span className="field-label">E-mail příjemce</span><input className="input" type="email" value={d.email} onChange={(e) => setDest({ ...d, email: e.target.value })} /></label>}
        <Row label="Práh pro formální podnět" hint="Počet podobných hlášení.">
          <input className="input" type="number" min={2} max={50} style={{ width: 90 }} value={d.threshold} onChange={(e) => setDest({ ...d, threshold: Number(e.target.value) })} />
        </Row>
        <Switch checked={d.auto_submit} onChange={(v) => setDest({ ...d, auto_submit: v })} label="Předat automaticky po dosažení prahu" />
        <div className="row" style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={() => saveSection("destinations", d).then(() => { setDest(null); st.reload(); })}>Uložit</button></div>
      </Card>
      <Card i={3} title="Aktualizace dat" icon="refresh" className="setting-block">
        <Switch checked={s.data.auto_refresh} onChange={(v) => saveSection("data", { auto_refresh: v }).then(st.reload)} label="Automaticky obnovovat katalog a vrstvy kraje" />
        <Row label="Interval">
          <select className="select" style={{ width: "auto" }} value={s.data.refresh_hours} onChange={(e) => saveSection("data", { refresh_hours: Number(e.target.value) }).then(st.reload)}>
            {[6, 12, 24, 72, 168].map((h) => <option key={h} value={h}>každých {h} h</option>)}
          </select>
        </Row>
      </Card>
    </div>
  );
}

/** Instalace na plochu. Tři stavy, které se navzájem vylučují: už je
 *  nainstalovaná (není co nabízet), prohlížeč poslal výzvu (tlačítko), nebo
 *  jsme v Safari na iOS (zbývá návod). Čtvrtý případ — prohlížeč instalaci
 *  neumí — nezobrazuje nic, protože rada, kterou nelze provést, jen mate. */
function Instalace() {
  const [lze, setLze] = useState(lzeVyzvat);
  const [hotovo, setHotovo] = useState(jeNainstalovana);
  useEffect(() => sledujInstalaci(() => setLze(lzeVyzvat())), []);
  const ios = potrebaIosNavod(navigator.userAgent, navigator.maxTouchPoints, hotovo);
  if (!lze && !ios && !hotovo) return null;

  return (
    <><div className="section-gap" />
    <Card i={1} title="Aplikace na ploše" icon="download">
      {hotovo ? (
        <p className="small muted" style={{ margin: 0 }}>
          KAM běží jako nainstalovaná aplikace. Otevře se i bez signálu — čísla jsou pak z poslední návštěvy
          a aplikace to nahoře přizná.
        </p>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Přidejte si KAM na plochu: spustí se na celou obrazovku, bez adresního řádku, a otevře se
            i bez signálu.
          </p>
          {lze ? (
            <button className="btn btn-primary" onClick={async () => {
              const ano = await nabidniInstalaci();
              if (ano) { setHotovo(true); toast("ok", "Hotovo, KAM najdete mezi aplikacemi."); }
            }}><Icon name="download" size={16} /> Instalovat aplikaci</button>
          ) : (
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 } as CSSProperties}>
              <li>Klepněte na <strong>Sdílet</strong> ve spodní liště Safari.</li>
              <li>Sjeďte na <strong>Přidat na plochu</strong>.</li>
              <li>Potvrďte <strong>Přidat</strong>.</li>
            </ol>
          )}
        </>
      )}
    </Card></>
  );
}

function AboutApp() {
  const h = useApi<{ ok: boolean; observations: number; time: string }>("/health");
  return (
    <Card i={0} title="KAM — Krajský analytický model" icon="info">
      <div className="facts-list">
        <div className="fact-row"><span>Verze</span><span>1.0.0</span></div>
        <div className="fact-row"><span>Server</span><span>{h.data?.ok ? "běží" : h.error ? "nedostupný" : "…"}</span></div>
        <div className="fact-row"><span>Měřených hodnot v databázi</span><span>{num(h.data?.observations ?? null)}</span></div>
        <div className="fact-row"><span>Výchozí vzhled</span><span>tmavý, průhlednost {DEFAULTS.transparency ? "zapnuta" : "vypnuta"}</span></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <Link className="btn btn-sm" to="/pravni">Právní informace</Link>
        <Link className="btn btn-sm" to="/o-nas">O nás</Link>
        <a className="btn btn-sm btn-quiet" href="/api/docs" target="_blank" rel="noopener noreferrer">Dokumentace API</a>
      </div>
    </Card>
  );
}

export function Settings({ tab }: { tab?: string }) {
  const current = TABS.some((t) => t.key === tab) ? tab! : "vzhled";
  return (
    <div>
      <PageHeader eyebrow="Nastavení" title={TABS.find((t) => t.key === current)!.label} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sekce nastavení">
          {TABS.map((t) => <Link key={t.key} to={`/nastaveni/${t.key}`} aria-current={t.key === current ? "page" : undefined}><Icon name={t.icon} size={17} />{t.label}</Link>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          {current === "vzhled" && <Appearance />}
          {current === "pristupnost" && <Accessibility />}
          {current === "modely" && <Models />}
          {current === "soukromi" && <Privacy />}
          {current === "aplikace" && <><AboutApp /><Instalace /></>}
        </div>
      </div>
    </div>
  );
}
