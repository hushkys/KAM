// Combobox for choosing a territory: the kraj, its okresy, 15 ORP and 448
// obcí, filtered locally as you type (without diacritics).
//
// The list is rendered into <body> with fixed positioning. Inside a card it
// would sit in the card's stacking context (cards animate in with a
// transform) and slide under the next card instead of over it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "../lib/api";
import { fold, num } from "../lib/format";
import { Erb } from "./Erb";
import { Icon } from "./Icon";

export interface TerritoryRow { id: string; level: string; level_label: string; name: string; population: number; parent: string | null }

export function useTerritories() {
  return useApi<TerritoryRow[]>("/territories?limit=500");
}

export function TerritoryPicker({ value, onChange, label = "Území", levels }: { value: string | null; onChange: (id: string, name: string) => void; label?: string; levels?: string[] }) {
  const { data } = useTerritories();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = data?.find((t) => t.id === value);
  const rows = useMemo(() => {
    const all = (data ?? []).filter((t) => !levels || levels.includes(t.level));
    const f = fold(q.trim());
    const hit = f ? all.filter((t) => fold(t.name).includes(f)) : all;
    hit.sort((a, b) => (f ? Number(!fold(a.name).startsWith(f)) - Number(!fold(b.name).startsWith(f)) : 0) || b.population - a.population);
    return hit.slice(0, 60);
  }, [data, q, levels]);

  const place = useCallback(() => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const viewH = window.visualViewport?.height ?? window.innerHeight;
    const below = viewH - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 180 && above > below;
    const maxH = Math.max(140, Math.min(320, up ? above : below));
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - maxH : r.bottom + 6, maxH });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, rows.length]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!input.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, place]);
  useEffect(() => { list.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }); }, [active]);

  const pick = (t: TerritoryRow) => { onChange(t.id, t.name); setOpen(false); setQ(""); input.current?.blur(); };
  return (
    <div className="picker">
      <span className="field-label">{label}</span>
      <div className="input-icon">
        <Icon name="pin" size={16} />
        <input ref={input} className="input" role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label={label} aria-controls="picker-listbox"
          value={open ? q : current ? `${current.name} · ${current.level_label}` : ""} placeholder={levels && levels.length === 1 && levels[0] === "obec" ? "Napište název obce…" : "Napište název obce, ORP nebo okresu…"} autoComplete="off" enterKeyHint="search"
          onFocus={() => { setOpen(true); setActive(0); }} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && rows[active]) { e.preventDefault(); pick(rows[active]); }
            else if (e.key === "Escape") setOpen(false);
          }} />
      </div>
      {open && pos && createPortal(
        <div ref={list} id="picker-listbox" className="picker-list glass" role="listbox" style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}>
          {rows.map((t, i) => (
            <button key={t.id} type="button" role="option" aria-selected={t.id === value} className={`picker-item ${i === active ? "is-active" : ""}`}
              onMouseEnter={() => setActive(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
              <Erb id={t.id} name={t.name} size={26} />
              <span className="picker-main">
                <strong>{t.name}</strong>
                <span className="picker-sub">{t.level_label}{t.parent && t.level === "obec" ? ` · ORP ${t.parent}` : ""}</span>
              </span>
              <span className="mute small num">{num(t.population)}</span>
            </button>
          ))}
          {!rows.length && <div className="empty"><strong>Žádné území tohoto názvu</strong></div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
