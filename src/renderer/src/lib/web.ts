import { useSyncExternalStore } from 'react';

export interface WebReq { url: string; title: string }
let cur: WebReq | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export const openWeb = (url: string, title: string) => { cur = { url, title }; emit(); };
export const closeWeb = () => { cur = null; emit(); };
export const useWebReq = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => cur);
