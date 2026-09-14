// App-wide right-click menu. The browser's own menu stays one Shift away.
//
// Rows come in three layers: the selection (copy, ask the assistant about
// it), the thing under the pointer (found through the nearest `data-ctx`
// attribute: a territory, a dataset, an indicator…), and a short list of
// app-wide actions so the menu is never empty.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navigate } from "../lib/router";
import { get as getPrefs, set as setPrefs, resolvedTheme } from "../lib/prefs";
import { toast } from "../lib/toast";
import { invalidate } from "../lib/api";
import { openAssistant } from "./assistantBus";
import { Icon } from "./Icon";

export interface Row { label: string; icon?: string; hint?: string; run?: () => void; danger?: boolean }
type Item = Row | "sep" | { head: string };

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("ok", "Zkopírováno do schránky.");
  } catch {
    toast("warn", "Schránka není dostupná — použijte Ctrl+C.");
  }
}

function targetRows(el: HTMLElement | null): Item[] {
  const host = el?.closest<HTMLElement>("[data-ctx]");
  if (!host) return [];
  const ctx = host.dataset.ctx ?? "";
  const label = host.dataset.ctxLabel ?? "";
  const url = host.dataset.ctxUrl ?? "";
  if (/^(obec|orp|okres|kraj):\d+$|^cz$/.test(ctx)) {
    const isHome = !ctx.startsWith("kraj:") || ctx === "kraj:86";
    return [
      { head: label || ctx },
      ...(isHome ? [
        { label: "Otevřít živý profil", icon: "arrow-right", run: () => navigate(`/obce/${ctx}`) },
        { label: "Výhled 2026–2040", icon: "trend-up", run: () => navigate(`/vyhled?t=${ctx}`) },
        { label: "Simulovat zásah", icon: "split", run: () => navigate(`/scenare?t=${ctx}`) },
        { label: "Nahlásit podnět", icon: "message", run: () => navigate(`/podnety?t=${ctx}`) },
      ] as Row[] : [
        { label: "Otevřená data kraje", icon: "database", run: () => navigate(`/data?region=${ctx.split(":")[1]}`) },
      ] as Row[]),
      { label: "Zeptat se asistenta", icon: "sparkle", run: () => openAssistant(`Co je nejdůležitější vědět o území ${label}?`, ctx) },
      { label: "Kopírovat kód území", icon: "copy", hint: ctx.split(":")[1], run: () => copy(ctx.split(":")[1] ?? ctx) },
      "sep",
    ];
  }
  if (ctx.startsWith("dataset")) {
    return [
      { head: label.slice(0, 60) || "Datová sada" },
      ...(url ? [{ label: "Otevřít v katalogu", icon: "external", run: () => window.open(url, "_blank", "noopener") } as Row] : []),
      ...(host.dataset.ctxDownload ? [{ label: "Stáhnout data", icon: "download", run: () => window.open(host.dataset.ctxDownload, "_blank", "noopener") } as Row] : []),
      ...(url ? [{ label: "Kopírovat odkaz", icon: "link", run: () => copy(url) } as Row] : []),
      { label: "Zeptat se asistenta", icon: "sparkle", run: () => openAssistant(`K čemu slouží datová sada „${label}“ a jak ji KAM využívá?`) },
      "sep",
    ];
  }
  if (ctx.startsWith("indicator:")) {
    return [
      { head: label || "Ukazatel" },
      { label: "Jak to víme?", icon: "info", run: () => openAssistant(`Jak KAM počítá ukazatel „${label}“ a z jakých dat?`) },
      { label: "Kopírovat hodnotu", icon: "copy", run: () => copy(host.dataset.ctxValue ?? label) },
      "sep",
    ];
  }
  return [];
}

export function ContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      const sel = String(window.getSelection?.() ?? "").trim();
      const items: Item[] = [];
      if (sel) {
        items.push({ label: "Kopírovat", icon: "copy", hint: "Ctrl+C", run: () => copy(sel) });
        items.push({ label: "Zeptat se asistenta na výběr", icon: "sparkle", run: () => openAssistant(`Vysvětli: „${sel.slice(0, 300)}“`) });
        items.push("sep");
      }
      items.push(...targetRows(t));
      const dark = resolvedTheme() === "dark";
      items.push(
        { label: "Zpět", icon: "arrow-left", hint: "Alt+←", run: () => history.back() },
        { label: "Hledat…", icon: "search", hint: "Ctrl+K", run: () => window.dispatchEvent(new CustomEvent("kam:palette")) },
        { label: "Asistent", icon: "sparkle", hint: "Ctrl+J", run: () => openAssistant() },
        { label: dark ? "Světlý režim" : "Tmavý režim", icon: dark ? "sun" : "moon", run: () => setPrefs({ theme: dark ? "light" : "dark" }) },
        { label: getPrefs().transparency ? "Vypnout průhlednost" : "Zapnout průhlednost", icon: "layers", run: () => setPrefs({ transparency: !getPrefs().transparency }) },
        { label: "Obnovit data", icon: "refresh", run: () => { invalidate(); window.dispatchEvent(new CustomEvent("kam:refresh")); toast("info", "Data se načítají znovu."); } },
        { label: "Kopírovat odkaz na stránku", icon: "link", run: () => copy(location.href) },
      );
      const w = 240, h = Math.min(items.length * 36 + 20, window.innerHeight - 16);
      setMenu({ x: Math.min(e.clientX, window.innerWidth - w - 8), y: Math.min(e.clientY, window.innerHeight - h - 8), items });
    };
    const close = () => setMenu(null);
    window.addEventListener("contextmenu", onCtx);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".ctx-row") ?? [])];
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[(i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
      }
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    setTimeout(() => ref.current?.querySelector<HTMLButtonElement>(".ctx-row")?.focus(), 0);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [menu]);

  if (!menu) return null;
  return createPortal(
    <div className="ctx-menu glass" role="menu" ref={ref} style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((it, i) => {
        if (it === "sep") return <div key={i} className="ctx-sep" role="separator" />;
        if ("head" in it) return <div key={i} className="ctx-head">{it.head}</div>;
        return (
          <button key={i} role="menuitem" className={`ctx-row ${it.danger ? "is-danger" : ""}`} onClick={() => { setMenu(null); it.run?.(); }}>
            <Icon name={it.icon ?? "chevron-right"} size={16} />
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
