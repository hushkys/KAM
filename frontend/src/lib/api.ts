// API client: JSON with timeouts, a stale-while-revalidate cache for reads,
// and a server-sent-events reader for the assistant.

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30000);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = typeof j.detail === "string" ? j.detail : detail;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, detail || `Chyba ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === "AbortError") throw new ApiError(0, opts.signal?.aborted ? "Zrušeno" : "Server neodpověděl včas.");
    throw new ApiError(0, "Server je nedostupný. Běží backend?");
  } finally {
    clearTimeout(timer);
  }
}

interface Entry {
  data: unknown;
  at: number;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = 60_000;

export function invalidate(prefix = ""): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export function fetchCached<T>(path: string, force = false): Promise<T> {
  const hit = cache.get(path);
  if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data as T);
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = api<T>(path)
    .then((d) => {
      cache.set(path, { data: d, at: Date.now() });
      return d;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function peek<T>(path: string): T | undefined {
  return cache.get(path)?.data as T | undefined;
}

/** Read hook: returns cached data at once, revalidates when stale. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(() => (path ? peek<T>(path) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path) && !(path && peek(path)));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    (force = false) => {
      if (!path) return;
      const cached = peek<T>(path);
      if (cached !== undefined) setData(cached);
      else setLoading(true);
      setError(null);
      fetchCached<T>(path, force)
        .then((d) => current.current === path && setData(d))
        .catch((e: ApiError) => current.current === path && setError(e))
        .finally(() => current.current === path && setLoading(false));
    },
    [path],
  );

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setData(peek<T>(path));
    load(false);
  }, [path, load]);

  return { data, error, loading, reload: () => load(true) };
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Parse a text/event-stream body into events. */
export async function* sse(body: unknown, signal: AbortSignal): AsyncGenerator<SSEEvent> {
  const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let detail = `Chyba ${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      yield parseBlock(block);
    }
  }
  if (buf.trim()) yield parseBlock(buf);
}

export function parseBlock(block: string): SSEEvent {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  try {
    return { event, data: JSON.parse(data.join("\n") || "{}") };
  } catch {
    return { event, data: { text: data.join("\n") } };
  }
}
