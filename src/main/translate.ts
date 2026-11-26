import { createHash } from 'node:crypto';
import { type DB, kvGet, kvSet } from './db';

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const MAX = 450;
const QUOTA_PAUSE = 6 * 3600_000;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
  ENTITIES[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));

export function chunks(text: string, max = MAX) {
  const parts = text.match(/[^.!?\n]+(?:[.!?]+|\n+|$)\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = (p: string) => { if (cur && (cur + p).length > max) { out.push(cur); cur = ''; } cur += p; };
  for (const p of parts) {
    if (p.length <= max) { push(p); continue; }
    for (const w of p.split(/(?<=\s)/)) push(w.length > max ? w.slice(0, max) : w);
  }
  if (cur.trim()) out.push(cur);
  return out.map(c => c.trim()).filter(Boolean);
}

export class Translator {
  private inflight = new Map<string, Promise<string | null>>();
  private pausedUntil = 0;

  constructor(private db: DB, private fetch: Fetch, private base = process.env.CARTUCHO_TRANSLATE_URL ?? 'https://api.mymemory.translated.net/get') {}

  cached(text: string, to = 'pt-BR', from = 'en') { return kvGet(this.db, this.key(text, to, from)); }
  private key(text: string, to: string, from: string) { return `tr.${from}.${to}.${createHash('sha1').update(text).digest('hex')}`; }

  translate(text: string, to = 'pt-BR', from = 'en'): Promise<string | null> {
    const t = text.trim();
    if (!t) return Promise.resolve('');
    const hit = this.cached(t, to, from);
    if (hit != null) return Promise.resolve(hit);
    if (Date.now() < this.pausedUntil) return Promise.resolve(null);
    const k = this.key(t, to, from);
    let p = this.inflight.get(k);
    if (!p) {
      p = this.run(t, to, from).then(r => { if (r != null) kvSet(this.db, k, r); return r; }).finally(() => this.inflight.delete(k));
      this.inflight.set(k, p);
    }
    return p;
  }

  private async run(text: string, to: string, from: string) {
    const out: string[] = [];
    for (const c of chunks(text)) {
      try {
        const r = await this.fetch(`${this.base}?q=${encodeURIComponent(c)}&langpair=${encodeURIComponent(`${from}|${to}`)}`, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(15_000) });
        const j = (await r.json().catch(() => null)) as { responseStatus?: number | string; responseData?: { translatedText?: string } } | null;
        const tr = j?.responseData?.translatedText;
        if (Number(j?.responseStatus) === 429 || r.status === 429 || /MYMEMORY WARNING|QUOTA/i.test(tr ?? '')) { this.pausedUntil = Date.now() + QUOTA_PAUSE; return null; }
        if (!r.ok || Number(j?.responseStatus) !== 200 || !tr) return null;
        out.push(decode(tr).trim());
      } catch { return null; }
    }
    return out.join(' ');
  }
}
