import { getLang } from './i18n';

/** Conquista rara: menos de RARE_PCT% dos jogadores têm. */
export const RARE_PCT = 5;
export const isRare = (pct: number | null | undefined): pct is number => typeof pct === 'number' && pct >= 0 && pct < RARE_PCT;
/** 0,8 · 3,2 · 12 (abaixo de 0,1 vira "<0,1"). */
export const fmtPct = (n: number) => (n < 0.1 ? `<${(0.1).toLocaleString(getLang() === 'en' ? 'en-US' : 'pt-BR')}` : n.toLocaleString(getLang() === 'en' ? 'en-US' : 'pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 }));
