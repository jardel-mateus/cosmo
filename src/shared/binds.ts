import { keyMapFor, type Key } from './padmap';

export type Bind = string[];
export interface Binds { summon: Bind; shot: Bind }
export type BindAction = keyof Binds;
export const DEFAULT_BINDS: Binds = { summon: ['Home'], shot: ['Home', 'RB'] };
export const HOLD = 1000;

const KEYS = new Set<string>(['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'LB', 'RB', 'LT', 'RT', 'X', 'Y', 'Start', 'Select', 'Home'] satisfies Key[]);
export const validToken = (t: string) => KEYS.has(t) || /^#\d{1,2}$/.test(t);

export function cleanBind(b: unknown): Bind | null {
  if (!Array.isArray(b)) return null;
  const out = [...new Set(b.filter((x): x is string => typeof x === 'string' && validToken(x)))].slice(0, 4);
  return out.length ? out : null;
}

export type BindsByPad = Record<string, Partial<Binds>>;

export function readAllBinds(raw: string | null | undefined): BindsByPad {
  const out: BindsByPad = {};
  try {
    const o = JSON.parse(raw || '{}') as Record<string, unknown>;
    for (const [id, v] of Object.entries(o)) {
      if (id === 'summon' || id === 'shot' || !v || typeof v !== 'object') continue;
      const e = v as Record<string, unknown>, summon = cleanBind(e.summon), shot = cleanBind(e.shot);
      if (summon || shot) out[id] = { ...(summon ? { summon } : {}), ...(shot ? { shot } : {}) };
    }
  } catch { }
  return out;
}

const hw = (id: string) => id.match(/vendor:\s*([0-9a-f]{4}).*product:\s*([0-9a-f]{4})/i)?.slice(1, 3).join(':').toLowerCase() ?? null;
export function bindsFor(all: BindsByPad, id: string): Binds {
  const key = all[id] ? id : (() => { const h = hw(id); return h ? Object.keys(all).find(k => hw(k) === h) : undefined; })();
  const b = key ? all[key] : undefined;
  return { summon: b?.summon ?? DEFAULT_BINDS.summon, shot: b?.shot ?? DEFAULT_BINDS.shot };
}

export const sameBind = (a: Bind, b: Bind) => a.length === b.length && a.every(x => b.includes(x));

export function padTokens(p: { id: string; mapping: string }, pressed: boolean[]): Set<string> {
  const map = keyMapFor(p, false), out = new Set<string>();
  pressed.forEach((v, i) => { if (v) out.add(map[i] ?? `#${i}`); });
  return out;
}
