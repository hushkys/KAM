// A small router.
//
// History API for real URLs (the server answers every path with the app).
// Page motion is an entrance only: the new page mounts with a short fade and
// rise (see `.page-enter` in base.css). There is deliberately no exit
// animation and no View Transitions API: snapshotting a whole page whose
// height changes made the old page shrink and fly away, and flickered next
// to the glass navbar. An entrance-only transition cannot do either.

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export interface Loc {
  path: string;
  query: URLSearchParams;
  hash: string;
  key: number;
}

let key = 0;
function snapshot(): Loc {
  return { path: location.pathname.replace(/\/+$/, "") || "/", query: new URLSearchParams(location.search), hash: location.hash.slice(1), key: key++ };
}

let loc: Loc = typeof window === "undefined" ? { path: "/", query: new URLSearchParams(), hash: "", key: 0 } : snapshot();
const listeners = new Set<() => void>();
const scrolls = new Map<string, number>();

function commit(scrollTo: number | null) {
  loc = snapshot();
  listeners.forEach((l) => l());
  requestAnimationFrame(() => {
    if (loc.hash) document.getElementById(loc.hash)?.scrollIntoView({ block: "start" });
    else if (scrollTo !== null) window.scrollTo(0, scrollTo);
  });
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    window.open(to, "_blank", "noopener");
    return;
  }
  const samePage = url.pathname === location.pathname;
  scrolls.set(location.pathname + location.search, window.scrollY);
  if (opts.replace || (samePage && url.search === location.search)) history.replaceState(null, "", url.pathname + url.search + url.hash);
  else history.pushState(null, "", url.pathname + url.search + url.hash);
  commit(samePage ? null : 0);
}

export function setQuery(params: Record<string, string | null | undefined>): void {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? `?${s}` : "") + location.hash);
  loc = snapshot();
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  history.scrollRestoration = "manual";
  window.addEventListener("popstate", () => commit(scrolls.get(location.pathname + location.search) ?? 0));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLocation(): Loc {
  return useSyncExternalStore(subscribe, () => loc, () => loc);
}

export interface Match {
  name: string;
  params: Record<string, string>;
}

const PATTERNS: [string, RegExp][] = [
  ["hook", /^\/$/],
  ["prehled", /^\/prehled$/],
  ["mapa", /^\/mapa$/],
  ["obce", /^\/obce$/],
  ["profil", /^\/obce\/(?<id>(?:obec|orp|okres|kraj):\d+|cz)$/],
  ["vyhled", /^\/vyhled$/],
  ["scenare", /^\/scenare$/],
  ["hospodareni", /^\/hospodareni$/],
  ["plany", /^\/plany$/],
  ["dotace", /^\/dotace$/],
  ["podnety", /^\/podnety$/],
  ["data", /^\/data$/],
  ["statistiky", /^\/statistiky$/],
  ["asistent", /^\/asistent$/],
  ["nastaveni", /^\/nastaveni(?:\/(?<tab>[a-z-]+))?$/],
  ["o-nas", /^\/o-nas$/],
  ["pravni", /^\/pravni$/],
];

export function match(path: string): Match {
  for (const [name, rx] of PATTERNS) {
    const m = rx.exec(path);
    if (m) return { name, params: (m.groups as Record<string, string>) ?? {} };
  }
  return { name: "404", params: {} };
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode };

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (/^https?:/.test(to)) return;
    e.preventDefault();
    navigate(to);
  };
  const external = /^https?:/.test(to);
  return (
    <a href={to} onClick={handle} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
      {children}
    </a>
  );
}
