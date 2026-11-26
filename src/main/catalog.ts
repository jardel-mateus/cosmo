import { z } from 'zod';
import { isSelfInstall, SELF_INSTALL, toConsoleId, toStatus } from '@shared/consoles';
import type { CatalogGame, RadarEvent } from '@shared/types';
import { type DB, kvGet, kvSet, tx } from './db';
import { tt } from '@shared/i18n';

export const CATALOG_URL = process.env.CARTUCHO_CATALOG_URL || 'https://recompendium.com/unricopie/catalogo.json';
export const absUrl = (u: string | null) => { if (!u) return null; try { return new URL(u, 'https://recompendium.com/unricopie/catalogo.json').href; } catch { return null; } };
const UA = { 'User-Agent': 'Cosmo/0.1 (+https://github.com/)' };

const lang = z.object({ es: z.string().nullish(), en: z.string().nullish() }).partial().nullish();
const Entry = z.object({
  entry: z.string(),
  nombre: z.string(),
  repo: z.string().nullish(),
  consola: z.string().nullish(),
  consola_nombre: z.string().nullish(),
  desarrollador: z.string().nullish(),
  anio: z.number().nullish(),
  estado: z.string().nullish(),
  desc: lang,
  requisitos: lang,
  retirado: z.boolean().nullish(),
  sin_enlace: z.boolean().nullish(),
  version: z.string().nullish(),
  fecha: z.string().nullish(),
  estrellas: z.number().nullish(),
  arte: z.object({ portada: z.string().nullish() }).partial().nullish(),
}).loose();
const Catalog = z.object({ formato: z.number(), generado: z.string().nullish(), entradas: z.array(z.unknown()) }).loose();

export interface RefreshResult { changed: boolean; total: number; added: number; statusChanged: number; updated: number; generatedAt: string | null; error?: string }

/**
 * Catálogos extras, no mesmo formato do Recompendium ({ formato: 1, entradas: [...] }).
 * Podem ser URLs (https://...) ou arquivos locais. Vêm do fontes.json da pasta de dados.
 * Um catálogo extra que falhar não derruba a atualização: só fica de fora desta vez.
 */
let extraCatalogs: string[] = [];
export const setExtraCatalogs = (list: string[]) => { extraCatalogs = [...new Set(list.map(s => s.trim()).filter(Boolean))]; };
export const getExtraCatalogs = () => extraCatalogs;

async function readExtra(src: string): Promise<unknown> {
  if (/^https?:\/\//i.test(src)) {
    const r = await fetch(src, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`${src} respondeu ${r.status}`);
    return r.json();
  }
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return JSON.parse((await readFile(src.startsWith('file:') ? fileURLToPath(src) : src, 'utf8')).replace(/^﻿/, ''));
}

async function extraEntries(): Promise<z.infer<typeof Entry>[]> {
  const out: z.infer<typeof Entry>[] = [];
  for (const src of extraCatalogs) {
    try {
      const raw = await readExtra(src);
      const list = Array.isArray(raw) ? raw : Catalog.parse(raw).entradas;
      for (const e of list) { const r = Entry.safeParse(e); if (r.success) out.push(r.data); }
    } catch (e) { console.warn('[catálogo extra]', src, e instanceof Error ? e.message : e); }
  }
  return out;
}

export async function refreshCatalog(db: DB, opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const headers: Record<string, string> = { ...UA };
  const etag = kvGet(db, 'catalog.etag'), modified = kvGet(db, 'catalog.lastModified');
  // Com catálogos extras, sempre baixa tudo: o principal pode não ter mudado, mas os extras sim.
  if (!opts.force && !extraCatalogs.length) { if (etag) headers['If-None-Match'] = etag; if (modified) headers['If-Modified-Since'] = modified; }

  const res = await fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(30_000) });
  kvSet(db, 'catalog.checkedAt', String(Date.now()));
  const total = (db.prepare('SELECT COUNT(*) n FROM catalog_game WHERE retired = 0').get() as { n: number }).n;
  if (res.status === 304) return { changed: false, total, added: 0, statusChanged: 0, updated: 0, generatedAt: kvGet(db, 'catalog.generatedAt') };
  if (!res.ok) throw new Error(tt('o Recompendium respondeu {0}', { 0: res.status }));

  const parsed = Catalog.parse(await res.json());
  if (parsed.formato !== 1) throw new Error(tt('formato de catálogo {0} ainda não suportado', { 0: parsed.formato }));
  const main = parsed.entradas.flatMap(e => { const r = Entry.safeParse(e); return r.success ? [r.data] : []; });
  // O catálogo principal ganha quando o mesmo jogo (mesmo "entry") aparece em mais de uma fonte.
  const seen = new Set(main.map(e => e.entry));
  const entries = [...main, ...(await extraEntries()).filter(e => !seen.has(e.entry) && (seen.add(e.entry), true))];

  const now = Date.now();
  const firstSync = total === 0;
  const prev = new Map((db.prepare('SELECT id, status, version, retired FROM catalog_game').all() as { id: string; status: string; version: string | null; retired: number }[]).map(r => [r.id, r]));
  const upsert = db.prepare(`
    INSERT INTO catalog_game (id, title, repo, console, platform_name, status, version, date, stars, year, developer, needs, description, cover_url, retired, no_link, first_seen_at, updated_at)
    VALUES (@id, @title, @repo, @console, @platformName, @status, @version, @date, @stars, @year, @developer, @needs, @description, @coverUrl, @retired, @noLink, @now, @now)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, repo=excluded.repo, console=excluded.console, platform_name=excluded.platform_name,
      status=excluded.status, version=excluded.version, date=excluded.date, stars=excluded.stars, year=excluded.year, developer=excluded.developer,
      needs=excluded.needs, description=excluded.description, cover_url=excluded.cover_url, retired=excluded.retired, no_link=excluded.no_link, updated_at=excluded.updated_at`);
  const event = db.prepare('INSERT INTO radar_event (game_id, kind, detail, at) VALUES (?, ?, ?, ?)');
  const installed = new Set((db.prepare('SELECT catalog_id FROM installed_game WHERE catalog_id IS NOT NULL').all() as { catalog_id: string }[]).map(r => r.catalog_id));

  let added = 0, statusChanged = 0, updated = 0;
  tx(db, () => {
    for (const e of entries) {
      const retired = e.retirado ? 1 : 0, noLink = e.sin_enlace ? 1 : 0;
      const row = {
        id: e.entry, title: e.nombre, repo: e.repo ?? null, console: toConsoleId(e.consola), platformName: e.consola_nombre ?? e.consola ?? 'Outros',
        status: toStatus(e.estado), version: e.version ?? null, date: e.fecha ?? null, stars: e.estrellas ?? 0, year: e.anio ?? null,
        developer: e.desarrollador ?? null, needs: e.requisitos?.en ?? e.requisitos?.es ?? null, description: e.desc?.en ?? e.desc?.es ?? null,
        coverUrl: e.arte?.portada ?? null, retired, noLink, now,
      };
      upsert.run(row);
      const p = prev.get(e.entry);
      if (firstSync || retired) continue;
      if (!p || p.retired) { event.run(e.entry, 'new', e.repo ?? '', now); added++; }
      else if (p.status !== row.status) { event.run(e.entry, 'up', `${p.status}→${row.status}`, now); statusChanged++; }
      else if (row.version && p.version !== row.version && installed.has(e.entry)) { event.run(e.entry, 'upd', `${p.version ?? '?'}→${row.version}`, now); updated++; }
    }
    db.exec('UPDATE installed_game SET console = (SELECT c.console FROM catalog_game c WHERE c.id = installed_game.catalog_id) WHERE catalog_id IN (SELECT id FROM catalog_game)');
  });

  if (res.headers.get('etag')) kvSet(db, 'catalog.etag', res.headers.get('etag')!);
  if (res.headers.get('last-modified')) kvSet(db, 'catalog.lastModified', res.headers.get('last-modified')!);
  if (parsed.generado) kvSet(db, 'catalog.generatedAt', parsed.generado);
  return { changed: true, total: entries.filter(e => !e.retirado).length, added, statusChanged, updated, generatedAt: parsed.generado ?? null };
}

type Row = { id: string; title: string; repo: string | null; console: string; platform_name: string; status: string; version: string | null; date: string | null; stars: number; year: number | null; developer: string | null; needs: string | null; description: string | null; cover_url: string | null; no_link: number; first_seen_at: number };
const toGame = (r: Row): CatalogGame => ({
  id: r.id, title: r.title, repo: isSelfInstall(r.console) ? null : r.repo, console: r.console as CatalogGame['console'], platformName: r.platform_name, status: r.status as CatalogGame['status'],
  version: r.version, date: r.date, stars: r.stars, year: r.year, developer: r.developer, needs: r.needs, description: r.description, coverUrl: absUrl(r.cover_url), noLink: !!r.no_link, firstSeenAt: r.first_seen_at,
});

const RANK: Record<string, number> = { full: 3, play: 2, wip: 1 };
export const titleKey = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function selfGroups(db: DB) {
  const rows = db.prepare(`SELECT c.id, c.title, c.console, c.status, c.stars, EXISTS(SELECT 1 FROM installed_game g WHERE g.catalog_id = c.id) inst
    FROM catalog_game c WHERE c.retired = 0 AND c.console IN (${[...SELF_INSTALL].map(() => '?').join(',')})`).all(...SELF_INSTALL) as
    { id: string; title: string; console: string; status: string; stars: number; inst: number }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.console + ':' + titleKey(r.title); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const rep = new Map<string, string>(), best = new Map<string, string>();
  for (const g of groups.values()) {
    const top = [...g].sort((a, b) => b.inst - a.inst || (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.stars - a.stars || a.id.localeCompare(b.id))[0]!;
    for (const r of g) rep.set(r.id, top.id);
    best.set(top.id, [...g].sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0))[0]!.status);
  }
  return { rep, best };
}

export function listCatalog(db: DB, filter: { console?: string; consoles?: string[]; search?: string } = {}): CatalogGame[] {
  const where = ['retired = 0'], args: string[] = [];
  if (filter.console) { where.push('console = ?'); args.push(filter.console); }
  if (filter.consoles?.length) { where.push(`console IN (${filter.consoles.map(() => '?').join(',')})`); args.push(...filter.consoles); }
  if (filter.search) { where.push(`(title LIKE ? OR (repo LIKE ? AND console NOT IN (${[...SELF_INSTALL].map(() => '?').join(',')})))`); args.push(`%${filter.search}%`, `%${filter.search}%`, ...SELF_INSTALL); }
  const { rep, best } = selfGroups(db);
  return (db.prepare(`SELECT * FROM catalog_game WHERE ${where.join(' AND ')} ORDER BY stars DESC, title`).all(...args) as Row[])
    .filter(r => !rep.has(r.id) || rep.get(r.id) === r.id)
    .map(r => ({ ...toGame(r), ...(best.has(r.id) ? { status: best.get(r.id) as CatalogGame['status'], firstSeenAt: r.first_seen_at } : {}) }));
}

export const RADAR_KEEP = 14 * 86400_000;

export function listRadar(db: DB, limit = 50, now = Date.now()): RadarEvent[] {
  return (db.prepare(`SELECT r.id, r.game_id, r.kind, r.detail, r.at, r.dismissed, r.seen_at, c.title, c.console FROM radar_event r JOIN catalog_game c ON c.id = r.game_id ORDER BY r.at DESC, r.id DESC LIMIT ?`).all(limit * 4) as
    { id: number; game_id: string; kind: RadarEvent['kind']; detail: string; at: number; dismissed: number; seen_at: number | null; title: string; console: RadarEvent['console'] }[])
    .map(r => ({ id: r.id, gameId: r.game_id, title: r.title, console: r.console, kind: r.kind, detail: r.kind === 'new' && isSelfInstall(r.console) ? '' : r.detail, at: r.at, gone: !!r.dismissed || (r.seen_at != null && now - r.seen_at > RADAR_KEEP) }))
    .filter(seenOnce(selfGroups(db).rep))
    .filter(r => !r.gone)
    .slice(0, limit)
    .map(({ gone: _, ...r }) => r);
}

export function dismissRadar(db: DB, ids: number[]) {
  if (!ids.length) return;
  db.prepare(`UPDATE radar_event SET dismissed = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

export function seeRadar(db: DB, ids: number[], now = Date.now()) {
  if (!ids.length) return;
  db.prepare(`UPDATE radar_event SET seen_at = ? WHERE seen_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids);
}

function seenOnce(rep: Map<string, string>) {
  const seen = new Set<string>();
  return <E extends RadarEvent>(e: E) => {
    if (!rep.has(e.gameId)) return true;
    e.gameId = rep.get(e.gameId)!;
    const k = e.gameId + ':' + e.kind;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  };
}

export function radarCounts(db: DB) {
  const seen = Number(kvGet(db, 'radar.seenAt') ?? 0);
  return db.prepare(`SELECT
      SUM(CASE WHEN at > ? THEN 1 ELSE 0 END) unseen,
      SUM(CASE WHEN kind = 'new' AND at > ? THEN 1 ELSE 0 END) fresh,
      SUM(CASE WHEN kind = 'upd' AND at > ? THEN 1 ELSE 0 END) updates
    FROM radar_event WHERE dismissed = 0`).get(seen, seen, seen) as { unseen: number | null; fresh: number | null; updates: number | null };
}
export const markRadarSeen = (db: DB) => kvSet(db, 'radar.seenAt', String(Date.now()));

export function perConsole(db: DB) {
  const since = Date.now() - 14 * 86400_000;
  const out: Record<string, { recomps: number; installed: number; fresh: number; platforms: number }> = {};
  for (const r of db.prepare(`SELECT console, COUNT(*) n, COUNT(DISTINCT platform_name) p, SUM(CASE WHEN id IN (SELECT game_id FROM radar_event WHERE kind = 'new' AND at > ?) THEN 1 ELSE 0 END) fresh
      FROM catalog_game WHERE retired = 0 GROUP BY console`).all(since) as { console: string; n: number; p: number; fresh: number }[])
    out[r.console] = { recomps: r.n, installed: 0, fresh: r.fresh ?? 0, platforms: r.p };
  for (const r of db.prepare('SELECT console, COUNT(*) n FROM installed_game GROUP BY console').all() as { console: string; n: number }[])
    (out[r.console] ??= { recomps: 0, installed: 0, fresh: 0, platforms: 0 }).installed = r.n;
  const { rep } = selfGroups(db);
  const freshIds = new Set((db.prepare("SELECT game_id FROM radar_event WHERE kind = 'new' AND at > ?").all(since) as { game_id: string }[]).map(r => rep.get(r.game_id) ?? r.game_id));
  for (const c of SELF_INSTALL) {
    if (!out[c]) continue;
    const reps = new Set([...(db.prepare('SELECT id FROM catalog_game WHERE retired = 0 AND console = ?').all(c) as { id: string }[])].map(r => rep.get(r.id) ?? r.id));
    out[c]!.recomps = reps.size; out[c]!.fresh = [...reps].filter(id => freshIds.has(id)).length;
  }
  return out;
}
export const platformCount = (db: DB) => (db.prepare("SELECT COUNT(DISTINCT platform_name) n FROM catalog_game WHERE retired = 0 AND console = 'other'").get() as { n: number }).n;
