// Ctrl+K: one box for everything — territories, datasets, methods, pages
// and app commands. Local results appear instantly; server results follow.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { fold, num } from "../lib/format";
import { set as setPrefs } from "../lib/prefs";
import { navigate } from "../lib/router";
import { openAssistant } from "./assistantBus";
import { Icon } from "./Icon";
import { NAV } from "./nav";

interface Hit { key: string; group: string; title: string; sub?: string; icon: string; run: () => void }

interface SearchRes {
  territories: { id: string; name: string; level_label: string; population: number; parent: string | null }[];
  datasets: { id: string; title: string; url: string; snippet: string }[];
  methods: { id: string; title: string; url: string; type: string }[];
}

const COMMANDS: Omit<Hit, "key" | "group">[] = [
  { title: "Tmavý režim", icon: "moon", run: () => setPrefs({ theme: "dark" }) },
  { title: "Světlý režim", icon: "sun", run: () => setPrefs({ theme: "light" }) },
  { title: "Motiv podle systému", icon: "monitor", run: () => setPrefs({ theme: "system" }) },
  { title: "Zapnout průhlednost", icon: "layers", run: () => setPrefs({ transparency: true }) },
  { title: "Vypnout průhlednost", icon: "layers", run: () => setPrefs({ transparency: false }) },
  { title: "Navigace dole", icon: "dock", run: () => setPrefs({ dock: "bottom" }) },
  { title: "Navigace po straně", icon: "sidebar", run: () => setPrefs({ dock: "side" }) },
  { title: "Vysoký kontrast", icon: "contrast", run: () => setPrefs({ contrast: "high" }) },
  { title: "Otevřít asistenta", icon: "sparkle", run: () => openAssistant() },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchRes | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, [contenteditable='true']");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setOpen(true); }
    };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("kam:palette", ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("kam:palette", ev); };
  }, []);

  useEffect(() => {
    if (open) { setQ(""); setRemote(null); setActive(0); setTimeout(() => input.current?.focus(), 20); }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setRemote(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<SearchRes>(`/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, timeout: 8000 }).then(setRemote).catch(() => {});
    }, 140);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const hits = useMemo<Hit[]>(() => {
    const f = fold(q.trim());
    const out: Hit[] = [];
    const pages = NAV.filter((n) => !f || fold(n.label).includes(f) || fold(n.desc).includes(f));
    for (const p of pages.slice(0, f ? 5 : 11)) out.push({ key: `p${p.path}`, group: "Stránky", title: p.label, sub: p.desc, icon: p.icon, run: () => navigate(p.path) });
    if (remote) {
      for (const t of remote.territories) out.push({ key: t.id, group: "Území", title: t.name, sub: `${t.level_label}${t.parent ? ` · ${t.parent}` : ""} · ${num(t.population)} obyv.`, icon: "pin", run: () => navigate(`/obce/${t.id}`) });
      for (const d of remote.datasets) out.push({ key: `d${d.id}`, group: "Datové sady", title: d.title, sub: d.snippet, icon: "database", run: () => window.open(d.url, "_blank", "noopener") });
      for (const m of remote.methods) out.push({ key: `m${m.id}`, group: m.type === "method" ? "Metodika a nápověda" : "Ukazatele", title: m.title, icon: m.type === "method" ? "book" : "chart", run: () => (m.url.startsWith("/") ? navigate(m.url) : window.open(m.url, "_blank", "noopener")) });
    }
    for (const c of COMMANDS.filter((c) => !f || fold(c.title).includes(f)).slice(0, f ? 4 : 5)) out.push({ ...c, key: `c${c.title}`, group: "Příkazy" });
    if (f.length > 2) out.push({ key: "ask", group: "Asistent", title: `Zeptat se: „${q.trim()}“`, icon: "sparkle", run: () => openAssistant(q.trim()) });
    return out;
  }, [q, remote]);

  useEffect(() => setActive(0), [hits.length]);
  useEffect(() => { list.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }); }, [active]);

  if (!open) return null;
  const pick = (h: Hit) => { setOpen(false); h.run(); };
  let lastGroup = "";
  return createPortal(
    <div className="palette-layer" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette glass" role="dialog" aria-modal="true" aria-label="Hledat">
        <div className="palette-input">
          <Icon name="search" size={20} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Obec, datová sada, stránka nebo příkaz…" aria-label="Hledat"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={hits[active] ? `ph-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter" && hits[active]) pick(hits[active]);
              else if (e.key === "Escape") setOpen(false);
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? <div className="palette-group" key={`g${h.group}`}>{h.group}</div> : null;
            lastGroup = h.group;
            return [head, (
              <button key={h.key} id={`ph-${i}`} role="option" aria-selected={i === active} className={`palette-item ${i === active ? "is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                <span className="pi-icon"><Icon name={h.icon} size={16} /></span>
                <span className="pi-text"><span className="pi-title">{h.title}</span>{h.sub && <span className="pi-sub">{h.sub}</span>}</span>
                {i === active && <Icon name="arrow-right" size={15} />}
              </button>
            )];
          })}
          {!hits.length && <div className="empty"><strong>Nic nenalezeno</strong></div>}
        </div>
        <div className="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> výběr</span><span><kbd>Enter</kbd> otevřít</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> hledání</span><span><kbd>Ctrl</kbd>+<kbd>J</kbd> asistent</span></div>
      </div>
    </div>,
    document.body,
  );
}
