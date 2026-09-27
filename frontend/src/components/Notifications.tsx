// The bell: data-gap alerts, the region's top risks and citizen clusters
// ready to be sent. Read state is remembered per browser.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { closeAssistant, useAssistantState } from "./assistantBus";
import { Icon } from "./Icon";
import { Severity } from "./ui";

interface Gaps { alerts: { level: string; title: string; text: string; kind: string }[] }
interface Overview { risks: { territory: { id: string; name: string }; top: { title: string; level: string; text: string } }[] }
interface Cluster { id: number; title: string; count: number; territory: { name: string } }

interface Note { id: string; level: string; title: string; text: string; href: string }

const KEY = "kam.notif.seen";
function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}

export function Notifications() {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(seen);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const gaps = useApi<Gaps>("/gaps");
  const ov = useApi<Overview>("/overview");
  const ready = useApi<Cluster[]>("/reports/clusters?status=pripraveno");

  const notes = useMemo<Note[]>(() => {
    const out: Note[] = [];
    for (const c of ready.data ?? []) out.push({ id: `c${c.id}`, level: "stredni", title: `Podnět připraven k odeslání: ${c.title}`, text: `${c.count} hlášení · ${c.territory.name}`, href: "/podnety" });
    // A bell that always says "9+" teaches people to ignore it: only the
    // few items that need a decision go here; the rest lives on its page.
    for (const r of (ov.data?.risks ?? []).slice(0, 3)) if (["vysoke", "kriticke"].includes(r.top.level)) out.push({ id: `r${r.territory.id}${r.top.title}`, level: r.top.level, title: `${r.territory.name}: ${r.top.title}`, text: r.top.text, href: `/obce/${r.territory.id}` });
    for (const a of (gaps.data?.alerts ?? []).filter((a) => a.kind !== "pokryti" && a.level !== "sledovat").slice(0, 3)) out.push({ id: `g${a.title}`, level: a.level, title: a.title, text: a.text, href: "/data?tab=potreby" });
    return out;
  }, [gaps.data, ov.data, ready.data]);

  const unread = notes.filter((n) => !read.has(n.id)).length;
  const assistant = useAssistantState();
  // The bell and the assistant occupy the same corner: only one at a time.
  useEffect(() => { if (assistant.open) setOpen(false); }, [assistant.open]);
  const toggle = () => setOpen((o) => { if (!o) closeAssistant(); return !o; });

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [open]);

  const markAll = () => {
    const s = new Set([...read, ...notes.map((n) => n.id)]);
    setRead(s);
    try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-300))); } catch { /* ignore */ }
  };
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} className={`icon-btn ${open ? "is-on" : ""}`} aria-label={`Upozornění${unread ? ` (nepřečtená: ${unread})` : ""}`} aria-expanded={open} onClick={toggle} title="Upozornění">
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="count-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && r && createPortal(
        <div ref={panel} className="popover glass" role="dialog" aria-label="Upozornění" style={{ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right - 60) }}>
          <div className="popover-head">
            <h3>Upozornění</h3>
            {unread > 0 && <button className="btn btn-quiet btn-sm" onClick={markAll}>Označit vše jako přečtené</button>}
          </div>
          {notes.length === 0 && <div className="empty"><strong>Nic nového</strong><p>Teď nic nečeká na vaše rozhodnutí.</p></div>}
          {notes.map((n) => (
            <Link key={n.id} to={n.href} className="notif" onClick={() => { setOpen(false); markAll(); }}>
              <span style={{ paddingTop: 3 }}><Severity level={n.level} label="" /></span>
              <span className="notif-body">
                <span className="notif-title" style={{ display: "block", fontWeight: read.has(n.id) ? 550 : 700 }}>{n.title}</span>
                <span className="notif-text">{n.text}</span>
              </span>
            </Link>
          ))}
          <div className="popover-head" style={{ paddingTop: 10 }}>
            <button className="btn btn-quiet btn-sm" onClick={() => { setOpen(false); navigate("/data?tab=potreby"); }}>Otevřít chybějící data <Icon name="arrow-right" size={14} /></button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
