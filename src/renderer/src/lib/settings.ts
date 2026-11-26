import { useSyncExternalStore } from 'react';

export interface Settings {
  pal: string;
  crtLvl: number;
  flicker: boolean;
  frame: boolean;
  glow: boolean;
  /** Palco em baixa resolução. Chave nova: a antiga ("pixel", ligada) nunca chegou a valer, então todo mundo começa com o palco liso. */
  pixelStage: boolean;
  blur: boolean;
  snd: boolean;
  vol: number;
  bootSnd: boolean;
  pad: 'auto' | 'kb' | 'xbox' | 'ps' | 'nin';
  boot: boolean;
  start: 'act' | 'stage';
  reduce: boolean;
  hidden: string[];
  picked: boolean;
  translate: boolean;
  xmbTheme: Record<string, number>;
  name: string;
  avatar: string;
  lang: 'auto' | 'pt' | 'en';
  /** cosmo = todos os hubs com a identidade do Cosmo; classic = cada hub imita a tela do console. */
  skin: 'cosmo' | 'classic';
}
export const DEFAULTS: Settings = { pal: 'cosmo', crtLvl: 0, flicker: false, frame: true, glow: true, pixelStage: false, blur: true, snd: true, vol: 70, bootSnd: true, pad: 'auto', boot: true, start: 'act', reduce: false, hidden: [], picked: false, translate: true, xmbTheme: {}, name: '', avatar: 'acc', lang: 'auto', skin: 'cosmo' };

const KEY = 'cartucho.set';
let state: Settings = (() => { try { const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; if (typeof s.xmbTheme !== 'object' || !s.xmbTheme) s.xmbTheme = {}; return s; } catch { return { ...DEFAULTS }; } })();
const subs = new Set<() => void>();

export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {  }
  subs.forEach(f => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const useSettings = () => useSyncExternalStore(subscribe, getSettings);

export const reduceMotion = () => state.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
