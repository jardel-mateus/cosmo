import { getLang, tt } from '@shared/i18n';
export const locale = () => (getLang() === 'en' ? 'en-US' : 'pt-BR');
export const clockStr = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
export function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return tt('agora'); if (m < 60) return tt('há {0} min', { 0: m });
  const h = Math.round(m / 60); if (h < 24) return tt('há {0} h', { 0: h });
  const d = Math.round(h / 24); if (d === 1) return tt('ontem'); if (d < 30) return tt('há {0} dias', { 0: d });
  return Math.round(d / 30) === 1 ? tt('há 1 mês') : tt('há {0} meses', { 0: Math.round(d / 30) });
}
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function hueOf(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
export const initials = (t: string) => t.replace(/^The /, '').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(w => w.length > 2 || /\d/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function fmtPlay(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 10 ? `${h}h` : `${h}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}`;
}
export const fmtSize = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
