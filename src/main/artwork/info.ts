import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type DB, kvGet, kvSet } from '../db';
import type { Fetch } from '../ports/github';
import { type Artwork, artPlatform, cleanTitle, looseKey } from './service';
import { tt } from '@shared/i18n';
import { steamManifest } from '../steam';

export interface Score { value: number; by: 'Metacritic' | 'OpenCritic' | 'IGDB'; url: string | null; platform: string | null; via: 'Wikidata' | 'Steam' | 'IGDB' }
export interface GameInfo { overview: string | null; lang: 'pt' | 'en' | null; developer: string | null; year: number | null; score: Score | null; ttb?: Ttb | null; lbPending?: boolean }
export interface InfoInput { console: string; platformName?: string | null; title: string; installDir?: string | null; exe?: string | null; catalogId?: string | null }
export interface Ttb { h?: number; n?: number; c?: number }
export interface NotaJogo { n: Score | null; t: number; i?: 1; z?: Ttb | null; zt?: number; zv?: number }
export interface Notas { gerado?: string; jogos?: Record<string, NotaJogo> }

export const infoKey = (console: string, platformName: string | null | undefined, title: string) => `${artPlatform(console, platformName) ?? console}:${looseKey(title)}`;

const UA = 'Cosmo/2.0 (https://github.com/jardel-mateus/cosmo)';
const FRESH = 30 * 86400_000, RETRY = 10 * 60_000, LB_AGAIN = 2 * 60_000;
const WD = process.env.CARTUCHO_WIKIDATA_API || 'https://www.wikidata.org/w/api.php';
export const NOTAS_URL = process.env.CARTUCHO_NOTAS_URL || 'https://raw.githubusercontent.com/GabrielGoris/cartucho/dados/notas.json';
const NOTAS_EVERY = 12 * 3600_000;
const CRITICS: Record<string, Score['by']> = { Q150248: 'Metacritic', Q21039459: 'OpenCritic' };
const EMPTY: GameInfo = { overview: null, lang: null, developer: null, year: null, score: null };

export const PLATFORM_LABEL: Record<string, RegExp> = {
  nes: /^(nintendo entertainment system|nes|famicom)$/i, snes: /^(super nintendo entertainment system|super nes|snes|super famicom)$/i,
  n64: /^nintendo 64$/i, gc: /^(nintendo )?gamecube$/i, wii: /^wii$/i, wiiu: /^wii u$/i, switch: /^nintendo switch$/i, switch2: /^nintendo switch 2$/i,
  gb: /^game boy$/i, gbc: /^game boy color$/i, gba: /^game boy advance$/i, nds: /^nintendo ds$/i, '3ds': /^nintendo 3ds$/i,
  ps1: /^playstation( \(console\))?$/i, ps2: /^playstation 2$/i, ps3: /^playstation 3$/i, ps4: /^playstation 4$/i, ps5: /^playstation 5$/i,
  psp: /^playstation portable$/i, vita: /^playstation vita$/i, xbox: /^xbox( \(console\))?$/i, x360: /^xbox 360$/i,
  pc: /^(microsoft windows|windows|personal computer|pc|pc \(microsoft windows\))$/i, megadrive: /^(sega )?(mega drive|genesis|mega drive\/genesis)$/i, dreamcast: /^(sega )?dreamcast$/i,
  saturn: /^(sega )?saturn$/i, mastersystem: /^(sega )?master system(\/mark iii)?$/i, arcade: /^arcade( game| video game)?$/i,
};

type Snak = { datavalue?: { value?: unknown } };
type Claim = { mainsnak: Snak; rank?: string; qualifiers?: Record<string, Snak[]> };
export interface WdEntity { id: string; labels?: Record<string, { value: string }>; claims?: Record<string, Claim[]> }

const idOf = (s?: Snak) => (s?.datavalue?.value as { id?: string } | undefined)?.id ?? null;
const strOf = (s?: Snak) => (typeof s?.datavalue?.value === 'string' ? s.datavalue.value : null);
const labelOf = (e?: WdEntity) => e?.labels?.en?.value ?? e?.labels?.mul?.value ?? null;

export function parseScore(v: string | null) {
  const m = v?.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*(?:\/\s*100)?$/);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n >= 0 && n <= 100 ? n : null;
}

export function pickScore(title: string, platform: string | null, games: WdEntity[], labels: Record<string, string>): Score | null {
  const want = platform ? PLATFORM_LABEL[platform] : undefined;
  const onPlatform = (q: string | null) => !!(q && want && labels[q] && want.test(labels[q]!));
  const key = looseKey(title);
  const scored = games.map((e, order) => ({
    e, order,
    plat: (e.claims?.P400 ?? []).some(c => onPlatform(idOf(c.mainsnak))),
    same: looseKey(labelOf(e) ?? '') === key,
  }));
  const pool = want && scored.some(x => x.plat) ? scored.filter(x => x.plat) : scored.filter(x => x.same);
  pool.sort((a, b) => Number(b.same) - Number(a.same) || a.order - b.order);
  const g = pool[0]; if (!g) return null;

  const opts: (Score & { rank: number })[] = [];
  for (const c of g.e.claims?.P444 ?? []) {
    if (c.rank === 'deprecated') continue;
    const by = CRITICS[idOf(c.qualifiers?.P447?.[0]) ?? ''];
    const value = parseScore(strOf(c.mainsnak));
    if (!by || value == null) continue;
    const plats = (c.qualifiers?.P400 ?? []).map(idOf);
    const match = plats.some(onPlatform), none = !plats.length;
    const rank = by === 'Metacritic' ? (match ? 0 : none ? 1 : 3) : 2;
    const pl = match ? plats.find(onPlatform)! : plats[0] ?? null;
    const id = strOf((g.e.claims?.[by === 'Metacritic' ? 'P1712' : 'P2864'] ?? [])[0]?.mainsnak);
    const name = labelOf(g.e) ?? title;
    const url = by === 'Metacritic'
      ? id ? `https://www.metacritic.com/${id.replace(/^\/+/, '')}` : `https://www.metacritic.com/search/${encodeURIComponent(name)}/`
      : id ? `https://opencritic.com/game/${id}/-` : null;
    opts.push({ value, by, url, platform: pl ? labels[pl] ?? null : null, via: 'Wikidata', rank });
  }
  opts.sort((a, b) => a.rank - b.rank);
  const best = opts[0];
  return best ? { value: best.value, by: best.by, url: best.url, platform: best.platform, via: 'Wikidata' } : null;
}

const STOP = new Set(['the', 'and', 'of']);
const tokens = (s: string) => cleanTitle(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').split(/[^a-z0-9]+/).filter(Boolean);
const related = (title: string, name: string) => {
  if (looseKey(title) === looseKey(name)) return true;
  const a = tokens(title), b = new Set(tokens(name));
  if (a.some(w => (/^\d+$/.test(w) || /^[ivx]{2,5}$/.test(w)) && !b.has(w))) return false;
  const big = a.filter(w => w.length >= 3 && !STOP.has(w));
  return big.length > 0 && big.filter(w => b.has(w)).length / big.length >= 0.5;
};
const igdbOn = (platform: string | null) => { const want = platform ? PLATFORM_LABEL[platform] : undefined; return (g: IgdbGame) => !!want && (g.platforms ?? []).some(p => want.test(p.name ?? '')); };

export interface IgdbGame { id?: number; name?: string; aggregated_rating?: number; aggregated_rating_count?: number; url?: string; platforms?: { name?: string }[] }

export function pickIgdb(title: string, platform: string | null, games: IgdbGame[]): Score | null {
  const want = platform ? PLATFORM_LABEL[platform] : undefined, key = looseKey(title);
  const rated = games.filter(g => g.aggregated_rating != null && (g.aggregated_rating_count ?? 0) > 0);
  const on = igdbOn(platform), plat = (g: IgdbGame) => on(g) && related(title, g.name ?? '');
  const same = (g: IgdbGame) => looseKey(g.name ?? '') === key;
  const pool = want && rated.some(plat) ? rated.filter(plat) : rated.filter(same);
  const g = [...pool].sort((a, b) => Number(same(b)) - Number(same(a)) || (b.aggregated_rating_count ?? 0) - (a.aggregated_rating_count ?? 0))[0];
  if (!g) return null;
  const p = want ? g.platforms?.find(x => want.test(x.name ?? ''))?.name ?? null : null;
  return { value: Math.round(g.aggregated_rating!), by: 'IGDB', url: g.url ?? null, platform: p, via: 'IGDB' };
}

export function igdbHasExact(title: string, platform: string | null, games: IgdbGame[]): boolean {
  const on = igdbOn(platform), key = looseKey(title);
  return games.some(g => looseKey(g.name ?? '') === key && (!platform || !PLATFORM_LABEL[platform] || on(g)));
}

export function matchIgdb(title: string, platform: string | null, games: IgdbGame[]): IgdbGame | null {
  const want = platform ? PLATFORM_LABEL[platform] : undefined, key = looseKey(title);
  const on = igdbOn(platform), plat = (g: IgdbGame) => on(g) && related(title, g.name ?? '');
  const same = (g: IgdbGame) => looseKey(g.name ?? '') === key;
  const pool = want && games.some(plat) ? games.filter(plat) : games.filter(same);
  return [...pool].sort((a, b) => Number(same(b)) - Number(same(a)) || (b.aggregated_rating_count ?? 0) - (a.aggregated_rating_count ?? 0))[0] ?? null;
}

export function ttbHours(t: { hastily?: number | null; normally?: number | null; completely?: number | null } | undefined): Ttb | null {
  if (!t) return null;
  const h = (s?: number | null) => (s && s > 0 ? Math.max(0.5, Math.round((s / 3600) * 2) / 2) : undefined);
  return tidyTtb({ h: h(t.hastily), n: h(t.normally), c: h(t.completely) });
}

export function tidyTtb(t: Ttb | null | undefined): Ttb | null {
  if (!t) return null;
  const out: Ttb = {};
  let last = 0;
  for (const k of ['h', 'n', 'c'] as const) {
    const v = t[k];
    if (v && v > 0 && v <= 500 && v >= last) { out[k] = v; last = v; }
  }
  return Object.keys(out).length ? out : null;
}

export function steamAppId(installDir?: string | null, exe?: string | null): string | null {
  const dirs = [exe ? dirname(exe) : null, installDir].filter((d): d is string => !!d);
  for (const d of dirs) {
    try { const t = readFileSync(join(d, 'steam_appid.txt'), 'utf8').trim(); if (/^\d+$/.test(t)) return t; } catch { }
  }
  return steamManifest(exe, installDir)?.appid ?? null;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plain = (h: string) => h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => ENT[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m))
  .replace(/\n{3,}/g, '\n\n').trim();

export type Json = <T>(url: string) => Promise<T>;

export async function wikidataScore(json: Json, title: string, platform: string | null): Promise<Score | null> {
  const q = cleanTitle(title);
  const found = await json<{ search?: { id: string; description?: string }[] }>(
    `${WD}?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=8&search=${encodeURIComponent(q)}`);
  const ids = (found.search ?? [])
    .filter(x => /game|remake|remaster/i.test(x.description ?? '') && !/soundtrack|manga|anime|series|franchise|character|list|film|novel|album/i.test(x.description ?? ''))
    .slice(0, 5).map(x => x.id);
  if (!ids.length) return null;
  const ents = await json<{ entities?: Record<string, WdEntity> }>(
    `${WD}?action=wbgetentities&format=json&props=labels|claims&languages=en|mul&ids=${ids.join('|')}`);
  const games = ids.map(id => ents.entities?.[id]).filter((e): e is WdEntity => !!e);
  const plats = new Set<string>();
  for (const e of games) {
    for (const c of e.claims?.P400 ?? []) { const p = idOf(c.mainsnak); if (p) plats.add(p); }
    for (const c of e.claims?.P444 ?? []) for (const s of c.qualifiers?.P400 ?? []) { const p = idOf(s); if (p) plats.add(p); }
  }
  const labels: Record<string, string> = {};
  const list = [...plats];
  for (let k = 0; k < list.length; k += 50) {
    const r = await json<{ entities?: Record<string, WdEntity> }>(`${WD}?action=wbgetentities&format=json&props=labels&languages=en|mul&ids=${list.slice(k, k + 50).join('|')}`);
    for (const [id, e] of Object.entries(r.entities ?? {})) { const l = labelOf(e); if (l) labels[id] = l; }
  }
  return pickScore(title, platform, games, labels);
}

export class GameInfoService {
  private pending = new Set<string>();
  private failed = new Map<string, number>();
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private notas = new Map<string, Score | null>();
  private ttb = new Map<string, Ttb>();

  constructor(private db: DB, private fetch: Fetch, private art: Artwork) {}

  private keyOf(i: InfoInput) { return infoKey(i.console, i.platformName, i.title); }

  setNotas(n: Notas) {
    this.notas = new Map(Object.entries(n.jogos ?? {}).map(([id, v]) => [id, v?.n ?? null]));
    this.ttb = new Map(Object.entries(n.jogos ?? {}).flatMap(([id, v]) => { const z = tidyTtb(v?.z); return z ? [[id, z] as const] : []; }));
    this.art.notify();
  }

  async startNotas() {
    try { const saved = kvGet(this.db, 'notas.json'); if (saved) this.setNotas(JSON.parse(saved) as Notas); } catch { }
    const tick = async (force = false) => {
      if (!force && Date.now() - Number(kvGet(this.db, 'notas.checkedAt') ?? 0) < NOTAS_EVERY) return;
      try {
        const etag = kvGet(this.db, 'notas.etag');
        const r = await this.fetch(NOTAS_URL, { headers: { 'User-Agent': UA, ...(etag && this.notas.size ? { 'If-None-Match': etag } : {}) }, signal: AbortSignal.timeout(30_000) });
        kvSet(this.db, 'notas.checkedAt', String(Date.now()));
        if (r.status === 304 || !r.ok) return;
        const text = await r.text(), n = JSON.parse(text) as Notas;
        if (!n?.jogos) return;
        kvSet(this.db, 'notas.json', text);
        if (r.headers.get('etag')) kvSet(this.db, 'notas.etag', r.headers.get('etag')!);
        this.setNotas(n);
      } catch { }
    };
    await tick(true);
    setInterval(() => void tick(), 3600_000).unref?.();
  }

  private row(key: string) {
    const r = this.db.prepare('SELECT json, fetched_at FROM game_info WHERE key = ?').get(key) as { json: string; fetched_at: number } | undefined;
    if (!r) return null;
    try { return { at: r.fetched_at, info: { ...EMPTY, ...(JSON.parse(r.json) as Partial<GameInfo>) } }; } catch { return null; }
  }

  get(i: InfoInput, first = true): GameInfo {
    const key = this.keyOf(i), r = this.row(key);
    const known = !!i.catalogId && this.notas.has(i.catalogId);
    const stale = !r || Date.now() - r.at > FRESH || (r.info.lbPending && Date.now() - r.at > LB_AGAIN);
    if (stale) this.enqueue(key, i, first, r?.info ?? null, !known);
    const info = r?.info ?? EMPTY;
    const ttb = i.catalogId ? this.ttb.get(i.catalogId) ?? null : null;
    return { ...info, ...(known && !info.score ? { score: this.notas.get(i.catalogId!) ?? null } : {}), ttb };
  }

  warm(list: InfoInput[]) { for (const i of list) this.get(i, false); }

  private enqueue(key: string, i: InfoInput, first: boolean, prev: GameInfo | null, score = true) {
    if (this.pending.has(key) || Date.now() - (this.failed.get(key) ?? 0) < RETRY) return;
    this.pending.add(key);
    const job = () => this.lookup(i, prev, score)
      .then(info => {
        this.db.prepare('INSERT INTO game_info (key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at')
          .run(key, JSON.stringify(info), Date.now());
        this.failed.delete(key);
        this.art.notify();
      }, () => { this.failed.set(key, Date.now()); })
      .finally(() => this.pending.delete(key));
    if (first) this.queue.unshift(job); else this.queue.push(job);
    this.pump();
  }

  private pump() {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => { this.running--; this.pump(); });
    }
  }

  async lookup(i: InfoInput, prev: GameInfo | null = null, score = true): Promise<GameInfo> {
    const reuse = prev?.lbPending && prev.score ? prev : null;
    const appid = steamAppId(i.installDir, i.exe);
    const steam = appid && !reuse ? this.steam(appid).catch(() => null) : Promise.resolve(null);
    const ready = await this.art.indexReady();
    const lb = ready ? await this.art.info(i.console, i.platformName, [i.title], true) : null;
    const out: GameInfo = { ...EMPTY, lbPending: !ready };
    if (lb) { out.overview = lb.overview; out.lang = lb.overview ? 'en' : null; out.developer = lb.developer; out.year = lb.year; }
    if (reuse) {
      if (reuse.lang === 'pt') { out.overview = reuse.overview; out.lang = 'pt'; }
      out.developer ??= reuse.developer; out.year ??= reuse.year; out.score = reuse.score;
      return out;
    }
    const s = await steam;
    if (s) {
      if (s.overview) { out.overview = s.overview; out.lang = 'pt'; }
      out.developer ??= s.developer; out.year ??= s.year;
      if (s.score) out.score = s.score;
    }
    if (!out.score && score) out.score = await this.wikidata(i.title, artPlatform(i.console, i.platformName));
    return out;
  }

  private async json<T>(url: string): Promise<T> {
    const r = await this.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(tt('erro {0}', { 0: r.status }));
    return r.json() as Promise<T>;
  }

  private async steam(appid: string) {
    const d = await this.json<Record<string, { success: boolean; data?: { short_description?: string; developers?: string[]; release_date?: { date?: string }; metacritic?: { score?: number; url?: string } } }>>(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=brazilian&cc=br`);
    const g = d[appid]; if (!g?.success || !g.data) return null;
    const mc = g.data.metacritic;
    return {
      overview: g.data.short_description ? plain(g.data.short_description) : null,
      developer: g.data.developers?.[0] ?? null,
      year: Number(g.data.release_date?.date?.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
      score: mc?.score ? { value: mc.score, by: 'Metacritic' as const, url: mc.url?.split('?')[0] ?? null, platform: 'PC', via: 'Steam' as const } : null,
    };
  }

  wikidata(title: string, platform: string | null) { return wikidataScore(u => this.json(u), title, platform); }
}
