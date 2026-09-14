// Toasts: short-lived confirmations and errors. Visual only — each one is
// also announced through the live region for screen readers.

import { useSyncExternalStore } from "react";

export type ToastKind = "ok" | "info" | "warn" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
}

let items: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(kind: ToastKind, text: string, action?: Toast["action"], ms = 4200): number {
  const id = ++seq;
  items = [...items.slice(-3), { id, kind, text, action }];
  emit();
  const live = document.getElementById(kind === "error" ? "alert-region" : "live-region");
  if (live) live.textContent = text;
  window.setTimeout(() => dismiss(id), ms);
  return id;
}

export function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}
