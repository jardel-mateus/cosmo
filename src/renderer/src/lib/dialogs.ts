import { useSyncExternalStore } from 'react';

export interface ConfirmReq { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean; alt?: string; resolve: (v: boolean | 'alt') => void }
let cur: ConfirmReq | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function askConfirm(o: Omit<ConfirmReq, 'resolve' | 'alt'>): Promise<boolean> {
  return new Promise(resolve => { cur = { ...o, resolve: v => { cur = null; emit(); resolve(v === true); } }; emit(); });
}
/** Pergunta com três saídas: 'ok' (botão principal), 'alt' (o do meio) ou null (cancelou). */
export function askChoice(o: Omit<ConfirmReq, 'resolve'> & { alt: string }): Promise<'ok' | 'alt' | null> {
  return new Promise(resolve => { cur = { ...o, resolve: v => { cur = null; emit(); resolve(v === true ? 'ok' : v === 'alt' ? 'alt' : null); } }; emit(); });
}
export const useConfirmReq = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => cur);

let menuOpen = false;
const menuSubs = new Set<() => void>();
export const setMenuOpen = (v: boolean) => { menuOpen = v; menuSubs.forEach(f => f()); };
export const isMenuOpen = () => menuOpen;
export const useMenuOpen = () => useSyncExternalStore(f => { menuSubs.add(f); return () => menuSubs.delete(f); }, () => menuOpen);
