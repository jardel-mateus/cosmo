import { EN } from './en';

export type Lang = 'pt' | 'en';
export type LangPref = 'auto' | Lang;
type Vars = Record<string, string | number | boolean | null | undefined>;

let lang: Lang = 'pt';
const subs = new Set<() => void>();

export const getLang = () => lang;
export function setLang(l: Lang) { if (l === lang) return; lang = l; subs.forEach(f => f()); }
export const onLang = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const pickLang = (pref: LangPref | undefined, locale: string): Lang => (pref === 'pt' || pref === 'en' ? pref : /^pt\b/i.test(locale) ? 'pt' : 'en');

export function tt(s: string, v?: Vars): string {
  const out = lang === 'en' ? EN[s] ?? s : s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k: string) => (!(k in v) ? m : v[k] == null || typeof v[k] === 'boolean' ? '' : String(v[k]))) : out;
}

export const ttn = (n: number, one: string, many: string, v?: Vars) => tt(n === 1 ? one : many, { n, ...v });
