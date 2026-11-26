/** Progresso de instalações/atualizações em andamento (chave = id do catálogo ou do jogo). */
import { useSyncExternalStore } from 'react';
import type { InstallProgress } from '@shared/types';

let state: Record<string, InstallProgress> = {};
const subs = new Set<() => void>();
export function pushProgress(p: InstallProgress) {
  state = { ...state, [p.key]: p };
  subs.forEach(f => f());
  if (p.done) setTimeout(() => { if (state[p.key] === p) { const { [p.key]: _, ...rest } = state; state = rest; subs.forEach(f => f()); } }, p.error ? 8000 : 2500);
}
export const useProgress = (key: string | null | undefined) =>
  useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => (key ? state[key] : undefined));
