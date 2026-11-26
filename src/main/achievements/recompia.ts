import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, AdapterContext, Definitions } from './adapters';
import type { Unlock } from './saves';
import { fetchImages, getJson } from './net';
import { achId } from './steam';
import { tt } from '@shared/i18n';

/**
 * Recompia (recomp do Pokémon Pokopia): o mod "community_achievements" grava o que você ganhou em
 * <pasta do jogo>/config/community_achievements/earned.tsv (uma linha "id<TAB>hora unix" por conquista).
 * A lista vem do catálogo de mods do Recompia e a porcentagem de jogadores, do serviço de contagem deles.
 */
const CATALOG = 'https://pokopia-native.vercel.app/mods/catalog.json';
const STATS = 'https://achievements.pokopia-native.workers.dev/api/stats';

/** Acha config/community_achievements dentro da pasta do jogo (até 3 níveis). */
export function recompiaDir(root: string): string | null {
  const q: [string, number][] = [[root, 0]];
  let seen = 0;
  while (q.length && seen < 200) {
    const [d, depth] = q.shift()!; seen++;
    let ents: Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name.toLowerCase() === 'config') { try { if (readdirSync(join(d, e.name)).some(n => n.toLowerCase() === 'community_achievements')) return join(d, e.name, 'community_achievements'); } catch { } }
      if (depth < 3 && !/^(shaders?|cache|romfs|exefs|\.git)$/i.test(e.name)) q.push([join(d, e.name), depth + 1]);
    }
  }
  return null;
}

export function readEarnedTsv(buf: Uint8Array): Unlock[] {
  const out: Unlock[] = [];
  for (const line of new TextDecoder('utf-8').decode(buf).split(/\r?\n/)) {
    const [id, at] = line.split('\t');
    const t = Number(at?.trim());
    if (id && Number.isFinite(t)) out.push({ id: achId(id), at: t > 0 ? t * 1000 : null, name: id });
  }
  return out;
}

/**
 * achievements.html que o mod gera na pasta dele com todas as conquistas (inclusive as que o catálogo do site não lista):
 * <li><img src="img/<id>.png"><div><b>Nome</b><small>Descrição [Earned <data>.]</small>…</div></li>
 */
export function parseRecompiaHtml(html: string): { id: string; name: string; desc: string }[] {
  const dec = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).trim();
  const out: { id: string; name: string; desc: string }[] = [];
  for (const li of html.match(/<li[\s\S]*?<\/li>/g) ?? []) {
    const id = li.match(/src="img\/([^"\/]+)\.png"/)?.[1], name = li.match(/<b>([\s\S]*?)<\/b>/)?.[1];
    if (!id || name == null || out.some(o => o.id === id)) continue;
    const desc = dec(li.match(/<small>([\s\S]*?)<\/small>/)?.[1] ?? '').replace(/\s*Earned\b[\s\S]*$/, '');
    out.push({ id, name: dec(name) || id, desc });
  }
  return out;
}

interface Ach { id: string; name: string; desc?: string; picture?: string }
async function catalog(): Promise<Ach[]> {
  const c = await getJson<{ achievements?: { list?: Ach[] } }>(CATALOG);
  return (c.achievements?.list ?? []).filter(a => a && typeof a.id === 'string');
}

export const recompia: Adapter = {
  id: 'recompia',
  label: tt('Conquistas da comunidade (Recompia)'),
  repos: ['recompia'],
  detect: dir => !!recompiaDir(dir),
  refreshDefs: true,
  async definitions(ctx): Promise<Definitions> {
    // Primeiro a página que o mod gera (tem todas, com imagens locais); o catálogo do site completa o que faltar.
    const dir = recompiaDir(ctx.installDir);
    let local: { id: string; name: string; desc: string }[] = [];
    if (dir && existsSync(join(dir, 'achievements.html'))) { try { local = parseRecompiaHtml(readFileSync(join(dir, 'achievements.html'), 'utf8')); } catch { } }
    const remote = await catalog().catch(() => [] as Ach[]);
    const byId = new Map(remote.map(a => [a.id, a]));
    const list: Ach[] = [...local.map(a => ({ ...byId.get(a.id), id: a.id, name: a.name, desc: a.desc })), ...remote.filter(a => !local.some(l => l.id === a.id))];
    if (!list.length) throw new Error(tt('o catálogo do Recompia não trouxe a lista de conquistas'));
    const images = new Map<number, Uint8Array>();
    for (const a of list) { try { if (dir) images.set(achId(a.id), new Uint8Array(readFileSync(join(dir, 'img', `${a.id}.png`)))); } catch { } }
    const urls = new Map(list.flatMap(a => (!images.has(achId(a.id)) && a.picture?.startsWith('https://pokopia-native.vercel.app/') ? [[achId(a.id), a.picture] as [number, string]] : [])));
    for (const [k, v] of await fetchImages(urls)) images.set(k, v);
    return { list: list.map(a => ({ id: achId(a.id), name: a.name || a.id, description: a.desc ?? '', points: null })), images, origin: local.length ? tt('lista do mod Community Achievements (Recompia)') : tt('catálogo de conquistas da comunidade do Recompia') };
  },
  unlockFile: (ctx: AdapterContext) => { const d = recompiaDir(ctx.installDir); return d ? join(d, 'earned.tsv') : ''; },
  readUnlocks: buf => readEarnedTsv(buf),
  async rarity() {
    const s = await getJson<{ players?: number; earned?: Record<string, number> }>(STATS).catch(() => null);
    if (!s?.players || !s.earned) return null;
    return new Map(Object.entries(s.earned).map(([k, n]) => [achId(k), Math.min(100, (Number(n) / s.players!) * 100)]));
  },
};
