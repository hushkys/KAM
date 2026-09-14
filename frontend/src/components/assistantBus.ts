// Tiny event bus so any part of the app can open the assistant with a
// question already typed (right-click "Zeptat se asistenta", profile button…).

import { useSyncExternalStore } from "react";

interface State { open: boolean; prompt: string | null; territory: string | null; nonce: number }
let state: State = { open: false, prompt: null, territory: null, nonce: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openAssistant(prompt?: string, territory?: string): void {
  state = { open: true, prompt: prompt ?? null, territory: territory ?? state.territory, nonce: state.nonce + 1 };
  emit();
}
export function closeAssistant(): void {
  state = { ...state, open: false, prompt: null };
  emit();
}
export function toggleAssistant(): void {
  state.open ? closeAssistant() : openAssistant();
}
export function setAssistantTerritory(t: string | null): void {
  if (state.territory === t) return;
  state = { ...state, territory: t };
  emit();
}
export function consumePrompt(): string | null {
  const p = state.prompt;
  state = { ...state, prompt: null };
  return p;
}
export function useAssistantState(): State {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}
