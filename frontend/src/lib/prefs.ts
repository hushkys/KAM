// Per-person appearance and accessibility preferences.
//
// They live in the browser because they must apply before the first paint
// (public/theme-init.js reads the same key synchronously), and they are
// written to <html> as data attributes so the stylesheet — not components —
// decides what each one means.

import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
export interface Prefs {
  theme: Theme;
  transparency: boolean;
  reduceMotion: boolean;
  contrast: "normal" | "high";
  fontScale: number;
  density: "comfortable" | "compact";
  dock: "bottom" | "side";
  dockLabels: boolean;
  underlineLinks: boolean;
  focusRing: boolean;
}

export const DEFAULTS: Prefs = {
  theme: "dark",
  transparency: true,
  reduceMotion: false,
  contrast: "normal",
  fontScale: 1,
  density: "comfortable",
  dock: "bottom",
  dockLabels: true,
  underlineLinks: false,
  focusRing: false,
};

const KEY = "kam.prefs";
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitize({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULTS };
  }
}

export function sanitize(p: Prefs): Prefs {
  const out = { ...p };
  if (!["system", "light", "dark"].includes(out.theme)) out.theme = DEFAULTS.theme;
  if (!["normal", "high"].includes(out.contrast)) out.contrast = "normal";
  if (!["comfortable", "compact"].includes(out.density)) out.density = "comfortable";
  if (!["bottom", "side"].includes(out.dock)) out.dock = "bottom";
  const fs = Number(out.fontScale);
  out.fontScale = Number.isFinite(fs) ? Math.min(1.3, Math.max(0.85, Math.round(fs * 100) / 100)) : 1;
  for (const k of ["transparency", "reduceMotion", "dockLabels", "underlineLinks", "focusRing"] as const) out[k] = Boolean(out[k]);
  return out;
}

let current: Prefs = typeof window === "undefined" ? { ...DEFAULTS } : read();

function systemDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}
function systemReduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function resolvedTheme(p: Prefs = current): "light" | "dark" {
  return p.theme === "system" ? (systemDark() ? "dark" : "light") : p.theme;
}

export function motionReduced(p: Prefs = current): boolean {
  return p.reduceMotion || systemReduced();
}

export function apply(p: Prefs = current): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(p);
  root.dataset.transparency = p.transparency ? "on" : "off";
  root.dataset.motion = motionReduced(p) ? "reduce" : "full";
  root.dataset.contrast = p.contrast;
  root.dataset.density = p.density;
  root.dataset.dock = p.dock;
  root.dataset.dockLabels = p.dockLabels ? "on" : "off";
  root.dataset.underline = p.underlineLinks ? "on" : "off";
  root.dataset.focus = p.focusRing ? "strong" : "normal";
  root.style.setProperty("--font-scale", String(p.fontScale));
  root.style.colorScheme = resolvedTheme(p);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolvedTheme(p) === "dark" ? "#0a0d0c" : "#f3f5f3");
}

export function get(): Prefs {
  return current;
}

export function set(patch: Partial<Prefs>): void {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: the preference still applies for this session */
  }
  apply(current);
  listeners.forEach((l) => l());
}

export function reset(): void {
  set({ ...DEFAULTS });
}

/** Apply an action coming from the assistant (already validated server-side). */
export function applyAction(key: string, value: unknown): string | null {
  switch (key) {
    case "theme":
      if (value === "dark" || value === "light" || value === "system") set({ theme: value });
      return "theme";
    case "transparency":
      set({ transparency: Boolean(value) });
      return key;
    case "reduceMotion":
      set({ reduceMotion: Boolean(value) });
      return key;
    case "contrast":
      set({ contrast: value === "high" ? "high" : "normal" });
      return key;
    case "density":
      set({ density: value === "compact" ? "compact" : "comfortable" });
      return key;
    case "dock":
      set({ dock: value === "side" ? "side" : "bottom" });
      return key;
    case "fontScale": {
      const step = value === "up" ? 0.1 : value === "down" ? -0.1 : 0;
      set({ fontScale: value === "reset" ? 1 : current.fontScale + step });
      return key;
    }
    default:
      return null;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, get, get);
}

if (typeof window !== "undefined") {
  apply(current);
  matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => current.theme === "system" && apply());
  matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => apply());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      current = read();
      apply(current);
      listeners.forEach((l) => l());
    }
  });
}
