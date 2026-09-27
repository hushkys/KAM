// The assistant: a chat that streams, shows where each answer came from and
// can operate the app. Used both as a drawer (anywhere, Ctrl+J) and as the
// full Asistent page.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, sse } from "../lib/api";
import { applyAction } from "../lib/prefs";
import { navigate, useLocation } from "../lib/router";
import { toast } from "../lib/toast";
import { closeAssistant, consumePrompt, useAssistantState } from "./assistantBus";
import { Icon } from "./Icon";
import { KindTag } from "./ui";

export interface Source { n: number; title: string; url: string; type: string }
interface Meta { route?: { intent: string; tier: string; reason: string; complexity?: string }; model?: string | null; territory?: { id: string; name: string } | null; sources?: Source[]; simulation?: { territory: string; interventions: unknown[] } | null }
export interface Msg { id: number; role: "user" | "assistant"; text: string; meta?: Meta; ms?: number; done?: boolean; note?: string; fallback?: boolean; error?: boolean }

const SESSION_KEY = "kam.chat.session";
let seq = 0;

function sessionId(): string {
  try {
    let s = localStorage.getItem(SESSION_KEY);
    if (!s) { s = crypto.randomUUID?.() ?? String(Date.now()); localStorage.setItem(SESSION_KEY, s); }
    return s;
  } catch { return crypto.randomUUID?.() ?? String(Date.now()); }
}

function inline(text: string, sources: Source[] = []): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const m = /^\[(\d+)\]$/.exec(p);
    if (m) {
      const s = sources.find((x) => x.n === Number(m[1]));
      return s ? <a key={i} className="cite" href={s.url} target={s.url.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" title={s.title}
        onClick={(e) => { if (s.url.startsWith("/")) { e.preventDefault(); navigate(s.url); } }}>{m[1]}</a> : <span key={i} className="cite is-dead">{m[1]}</span>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const KIND_RX = /^(FAKT|TREND|MODEL|SCÉNÁŘ|SCENAR|INTERPRETACE|AI INTERPRETACE)\s*[:—–-]?\s*/i;

export function Markdown({ text, sources }: { text: string; sources?: Source[] }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>); list = []; } };
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (!line) { flush(); return; }
    const bullet = /^([-*•]|\d+[.)])\s+/.exec(line);
    if (bullet) line = line.slice(bullet[0].length);
    if (/^#{1,4}\s/.test(line)) { flush(); blocks.push(<h4 key={i}>{inline(line.replace(/^#+\s/, ""), sources)}</h4>); return; }
    let tag: ReactNode = null;
    const k = KIND_RX.exec(line.replace(/^\*\*/, "").replace(/\*\*(?=\s*[:—–-])/, ""));
    if (k) {
      const word = k[1].toUpperCase();
      tag = <KindTag kind={word.includes("INTERPRET") ? "AI" : word === "SCENAR" ? "SCÉNÁŘ" : word} />;
      line = line.replace(/^\*\*/, "").replace(/\*\*(?=\s*[:—–-])/, "").slice(k[0].length);
    }
    const content = <>{tag}{tag && " "}{inline(line, sources)}</>;
    if (bullet) list.push(<li key={i}>{content}</li>);
    else { flush(); blocks.push(<p key={i}>{content}</p>); }
  });
  flush();
  return <div className="md">{blocks}</div>;
}

export function useChat(territory: string | null) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [sid, setSid] = useState<string>(sessionId);
  const ctrl = useRef<AbortController | null>(null);
  const { path } = useLocation();

  const patch = (id: number, fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const uid = ++seq, aid = ++seq;
    const history = msgs.filter((m) => m.done !== false).slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((all) => [...all, { id: uid, role: "user", text: q, done: true }, { id: aid, role: "assistant", text: "", done: false }]);
    setBusy(true);
    ctrl.current = new AbortController();
    const pendingNav: string[] = [];
    let tier = "";
    try {
      for await (const ev of sse({ message: q, session_id: sid, context: { territory: territory ?? "", route: path }, history }, ctrl.current.signal)) {
        const d = ev.data as Record<string, unknown>;
        if (ev.event === "meta") {
          tier = String((d.route as Meta["route"])?.tier ?? "");
          if (typeof d.session_id === "string" && d.session_id !== sid) setSid(d.session_id);
          patch(aid, (m) => ({ ...m, meta: d as Meta }));
        } else if (ev.event === "action") {
          if (d.type === "set_pref") {
            applyAction(String(d.key), d.value);
          } else if (d.type === "navigate") {
            if (tier === "rules" || tier === "") navigate(String(d.path));
            else pendingNav.push(String(d.path));
          }
        } else if (ev.event === "token") {
          patch(aid, (m) => ({ ...m, text: m.text + String(d.text ?? "") }));
        } else if (ev.event === "replace") {
          patch(aid, (m) => ({ ...m, text: String(d.text ?? "") }));
        } else if (ev.event === "note") {
          patch(aid, (m) => ({ ...m, note: String(d.text ?? "") }));
        } else if (ev.event === "done") {
          // `done` names the model that actually answered; the earlier `meta`
          // only named the one the router reached for, and the two differ
          // whenever the routed tier was unreachable and the other one stepped in.
          patch(aid, (m) => ({ ...m, done: true, ms: Number(d.ms ?? 0), fallback: Boolean(d.fallback),
                               meta: d.model ? { ...m.meta, model: String(d.model) } : m.meta }));
        } else if (ev.event === "error") {
          patch(aid, (m) => ({ ...m, done: true, error: true, text: m.text || String(d.text ?? "Asistent neodpověděl. Zkuste to prosím znovu.") }));
        }
      }
      pendingNav.forEach((p) => navigate(p));
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      patch(aid, (m) => ({ ...m, done: true, error: !aborted, text: m.text || (aborted ? "Odpověď jste zastavili." : (e as Error).message) }));
    } finally {
      patch(aid, (m) => ({ ...m, done: true }));
      setBusy(false);
      ctrl.current = null;
    }
  }, [busy, msgs, sid, territory, path]);

  const stop = () => ctrl.current?.abort();
  const reset = () => {
    stop();
    setMsgs([]);
    const s = crypto.randomUUID?.() ?? String(Date.now());
    try { localStorage.setItem(SESSION_KEY, s); } catch { /* ignore */ }
    setSid(s);
  };
  const load = async (id: string) => {
    try {
      const rows = await api<{ role: "user" | "assistant"; content: string; meta: Meta }[]>(`/chat/sessions/${id}`);
      setMsgs(rows.map((r) => ({ id: ++seq, role: r.role, text: r.content, meta: r.meta, done: true })));
      setSid(id);
      try { localStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
    } catch (e) { toast("error", (e as Error).message); }
  };
  return { msgs, busy, send, stop, reset, load, sid };
}

function Bubble({ m, onAsk }: { m: Msg; onAsk: (q: string) => void }) {
  if (m.role === "user") return <div className="msg msg-user"><div className="msg-bubble">{m.text}</div></div>;
  const sources = m.meta?.sources ?? [];
  const route = m.meta?.route;
  return (
    <div className="msg msg-ai">
      <div className="msg-bubble">
        {!m.text && !m.done && <span className="typing" aria-label="Asistent píše"><i /><i /><i /></span>}
        {m.text && <Markdown text={m.text} sources={sources} />}
        {m.note && <p className="xsmall mute">{m.note}</p>}
        {m.meta?.simulation && (
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => navigate(`/scenare?t=${m.meta!.simulation!.territory}&iv=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(m.meta!.simulation!.interventions)))))}`)}>
            <Icon name="split" size={15} /> Otevřít ve Scénářích
          </button>
        )}
      </div>
      {m.done && (sources.length > 0 || route) && (
        <div className="msg-meta">
          {route && (
            <span className="route-badge" title={route.reason}>
              <Icon name={route.tier === "cloud" ? "globe" : route.tier === "rules" ? "wand" : route.tier === "none" ? "shield" : "monitor"} size={13} />
              {route.tier === "rules" ? "Příkaz aplikace" : route.tier === "none" ? "Ochrana" : m.meta?.model ?? "model"}
              {m.ms ? ` · ${(m.ms / 1000).toFixed(1).replace(".", ",")} s` : ""}
              {m.fallback ? " · jen podklady, bez AI" : ""}
            </span>
          )}
          {sources.slice(0, 8).map((s) => (
            <a key={s.n} className="src-chip" href={s.url} target={s.url.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" title={`${s.type}: ${s.title}`}
              onClick={(e) => { if (s.url.startsWith("/")) { e.preventDefault(); navigate(s.url); } }}
              data-ctx="dataset" data-ctx-label={s.title} data-ctx-url={s.url}>
              <b>{s.n}</b><span>{s.title}</span>
            </a>
          ))}
        </div>
      )}
      {m.done && m.meta?.territory && m.role === "assistant" && m.meta.route?.intent !== "ACTION" && (
        <div className="chips" style={{ marginTop: 6 }}>
          <button className="chip-btn" onClick={() => onAsk(`Proč je ${m.meta!.territory!.name} rizikové území?`)}>Proč je rizikové</button>
          <button className="chip-btn" onClick={() => onAsk(`Co se v území ${m.meta!.territory!.name} stane, když nic neuděláme?`)}>Co když se nic neudělá</button>
          <button className="chip-btn" onClick={() => navigate(`/obce/${m.meta!.territory!.id}`)}>Otevřít profil</button>
        </div>
      )}
    </div>
  );
}

export type ChatState = ReturnType<typeof useChat>;

/** Příklady otázek pod polem. Nejsou to reklamní návrhy: každá míří na jiný
 *  druh odpovědi (rizika, rozpočet, scénář, ovládání aplikace), takže
 *  člověk, který asistenta vidí poprvé, pochopí, co všechno se dá zeptat.
 *  Jen na stránce asistenta — v šuplíku na telefonu by vytlačily pozdrav. */
const PRIKLADY = [
  "Kterým obcím v kraji hrozí vylidnění?",
  "Jak hospodaří Náchod?",
  "Co kdyby Jaroměř rozšířila základní školu?",
  "Přepni na tmavý motiv a otevři mapu",
];

export function Chat({ territory, compact = false, onClose, header, chat }: {
  territory: string | null; compact?: boolean; onClose?: () => void; header?: ReactNode; chat?: ChatState }) {
  const own = useChat(territory);
  const { msgs, busy, send, stop, reset } = chat ?? own;
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const pole = useRef<HTMLFormElement>(null);
  /** Kde pole stálo, než se rozhovor rozjel — z toho se dopočítá jeho cesta dolů. */
  const odkud = useRef<DOMRect | null>(null);
  const state = useAssistantState();
  const uvod = msgs.length === 0;

  useEffect(() => {
    const p = consumePrompt();
    if (p) send(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nonce]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    const ta = area.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; }
  }, [text]);

  /** Pole se z prostředka nepřekreslí dole, ono tam sjede.
   *
   *  Klasický FLIP: pozici si vezmeme těsně před odesláním, po překreslení
   *  změříme novou a rozdíl přehrajeme pozpátku. Je to tentýž prvek, takže
   *  rozepsaný text i kurzor v něm zůstávají — dvě pole, která se prolnou, by
   *  tohle neuměla. */
  useLayoutEffect(() => {
    const el = pole.current, r0 = odkud.current;
    odkud.current = null;
    if (!el || !r0 || document.documentElement.dataset.motion === "reduce") return;
    const r1 = el.getBoundingClientRect();
    const dy = r0.top - r1.top;
    if (Math.abs(dy) < 2) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
      { duration: 620, easing: "cubic-bezier(.32,.72,0,1)" });
  }, [uvod]);

  const submit = () => {
    if (!text.trim()) return;
    if (uvod && pole.current) odkud.current = pole.current.getBoundingClientRect();
    send(text);
    setText("");
  };

  return (
    <div className={`chat ${compact ? "is-compact" : ""}`} data-stav={uvod ? "uvod" : "chat"}>
      <div className="chat-head">
        {header ?? <span className="chat-nazev"><Icon name="sparkle" size={15} /> Asistent</span>}
        <span className="navbar-spacer" />
        {!uvod && <button className="icon-btn sm" onClick={reset} aria-label="Nová konverzace" title="Nová konverzace"><Icon name="plus" size={17} /></button>}
        {onClose && <button className="icon-btn sm" onClick={onClose} aria-label="Zavřít asistenta"><Icon name="close" size={17} /></button>}
      </div>

      {uvod && <span className="chat-vzduch-horni" aria-hidden="true" />}
      {uvod ? (
        <div className="chat-uvod">
          <span className="chat-znak" aria-hidden="true"><Icon name="sparkle" size={compact ? 20 : 24} /></span>
          <h2 className="chat-pozdrav">Na co se podíváme?</h2>
          <p className="chat-uvod-text">
            Zeptejte se vlastními slovy. Čísla spočítá aplikace, já je vysvětlím a u každého uvedu zdroj.
          </p>
        </div>
      ) : (
        <div className="chat-log" ref={log} aria-live="polite">
          {msgs.map((m) => <Bubble key={m.id} m={m} onAsk={send} />)}
        </div>
      )}

      <form className="chat-pole" ref={pole} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea ref={area} rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
          placeholder={uvod ? "Zeptejte se na obec, rozpočet nebo výhled…" : "Napište další otázku nebo příkaz…"} aria-label="Zpráva asistentovi"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        {busy
          ? <button type="button" className="icon-btn send" onClick={stop} aria-label="Zastavit odpověď"><Icon name="stop" /></button>
          : <button type="submit" className="icon-btn send" disabled={!text.trim()} aria-label="Odeslat otázku"><Icon name="send" /></button>}
      </form>

      {uvod && !compact && (
        <div className="chat-priklady" aria-label="Příklady otázek">
          {PRIKLADY.map((p) => (
            <button key={p} type="button" className="chat-priklad" onClick={() => send(p)}>
              <span>{p}</span><Icon name="arrow-right" size={14} />
            </button>
          ))}
        </div>
      )}
      {uvod && <span className="chat-vzduch" aria-hidden="true" />}

      <div className="disclaimer chat-disclaimer"><Icon name="info" size={13} /><span>Odpověď píše AI a může se mýlit. Čísla ověřte v uvedených zdrojích.</span></div>
    </div>
  );
}

export function AssistantDrawer() {
  const state = useAssistantState();
  const { path } = useLocation();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); state.open ? closeAssistant() : window.dispatchEvent(new CustomEvent("kam:assistant")); }
      if (e.key === "Escape" && state.open && !document.querySelector(".modal-layer, .palette-layer")) closeAssistant();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state.open]);

  // Klepnutí vedle šuplíku ho zavře. Výjimky jsou dvě: tlačítko v navbaru si
  // přepíná samo (jinak by se šuplík na `pointerdown` zavřel a hned na `click`
  // zase otevřel) a vrstvy, které leží nad ním — dialog, paleta, kontextové
  // menu. Ty se zavírají vlastním scrimem a šuplík pod nimi má zůstat.
  useEffect(() => {
    if (!state.open || path === "/asistent") return;
    const vedle = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || box.current?.contains(t)) return;
      if (t.closest?.("[data-assistant-toggle], .modal-layer, .palette-layer, .ctx-menu")) return;
      closeAssistant();
    };
    document.addEventListener("pointerdown", vedle, true);
    return () => document.removeEventListener("pointerdown", vedle, true);
  }, [state.open, path]);

  if (!state.open || path === "/asistent") return null;
  return createPortal(
    <aside ref={box} className="assistant-drawer glass" aria-label="Asistent">
      <Chat territory={state.territory} compact onClose={closeAssistant} />
    </aside>,
    document.body,
  );
}
