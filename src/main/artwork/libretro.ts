import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { Fetch } from '../ports/github';

/**
 * Segunda fonte de capas: o acervo libretro-thumbnails (o mesmo do RetroArch), lido direto do GitHub.
 * Cada sistema é um repositório com as pastas Named_Boxarts / Named_Snaps / Named_Titles, e os arquivos
 * têm o nome No-Intro do jogo ("Super Mario 64 (USA).png"). Baixamos a lista de nomes uma vez por mês
 * e casamos pelo título "solto" (sem região, acentos e pontuação).
 */
export const LIBRETRO_SYSTEMS: Record<string, string> = {
  nes: 'Nintendo - Nintendo Entertainment System', snes: 'Nintendo - Super Nintendo Entertainment System', n64: 'Nintendo - Nintendo 64',
  gc: 'Nintendo - GameCube', wii: 'Nintendo - Wii', wiiu: 'Nintendo - Wii U', nds: 'Nintendo - Nintendo DS', '3ds': 'Nintendo - Nintendo 3DS',
  gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color', gba: 'Nintendo - Game Boy Advance',
  megadrive: 'Sega - Mega Drive - Genesis', dreamcast: 'Sega - Dreamcast', saturn: 'Sega - Saturn', mastersystem: 'Sega - Master System - Mark III',
  ps1: 'Sony - PlayStation', ps2: 'Sony - PlayStation 2', psp: 'Sony - PlayStation Portable', ps3: 'Sony - PlayStation 3', vita: 'Sony - PlayStation Vita',
  xbox: 'Microsoft - Xbox', x360: 'Microsoft - Xbox 360',
};

export type LibretroKind = 'cover' | 'screenshot' | 'logo' | 'fanart';
const FOLDER: Partial<Record<LibretroKind, string>> = { cover: 'Named_Boxarts', screenshot: 'Named_Snaps' };
const REFRESH_AFTER = 30 * 86400_000;
const LIST_VERSION = 1;

/** Ordem de preferência das regiões quando há várias capas do mesmo jogo. */
const regionRank = (f: string) => /\((USA|World)/i.test(f) ? 0 : /\(Europe/i.test(f) ? 1 : /\(Japan/i.test(f) ? 3 : 2;

interface Listing { version: number; built: number; files: Record<string, string[]> }

export interface LibretroOpts {
  folder: string;
  fetch: Fetch;
  key: (s: string) => string;
  api?: string;
  raw?: string;
  token?: () => string | null;
}

export function createLibretro({ folder, fetch, key, api = 'https://api.github.com', raw = 'https://raw.githubusercontent.com', token = () => null }: LibretroOpts) {
  const cache = new Map<string, Promise<Listing | null>>();
  const repoOf = (system: string) => system.replace(/ /g, '_');

  const headers = () => {
    const h: Record<string, string> = { 'User-Agent': 'Cosmo', Accept: 'application/vnd.github+json' };
    const t = token(); if (t) h.Authorization = `Bearer ${t}`;
    return h;
  };
  const getJson = async <T>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return (await r.json()) as T;
  };

  async function build(platform: string, kind: LibretroKind): Promise<Listing | null> {
    const system = LIBRETRO_SYSTEMS[platform], dir = FOLDER[kind];
    if (!system || !dir) return null;
    const file = join(folder, `${platform}-${kind}.json`);
    try {
      const st = await fsp.stat(file);
      const l = JSON.parse(await fsp.readFile(file, 'utf8')) as Listing;
      if (l.version === LIST_VERSION && Date.now() - st.mtimeMs < REFRESH_AFTER) return l;
    } catch { /* sem cache ainda */ }
    const repo = `libretro-thumbnails/${repoOf(system)}`;
    const root = await getJson<{ tree?: { path: string; type: string; sha: string }[] }>(`${api}/repos/${repo}/git/trees/HEAD`);
    const sub = root.tree?.find(t => t.type === 'tree' && t.path === dir);
    if (!sub) return null;
    const list = await getJson<{ tree?: { path: string; type: string }[] }>(`${api}/repos/${repo}/git/trees/${sub.sha}`);
    const files: Record<string, string[]> = Object.create(null);
    for (const t of list.tree ?? []) {
      if (t.type !== 'blob' || !/\.png$/i.test(t.path)) continue;
      const k = key(t.path.replace(/\.png$/i, ''));
      if (k) (files[k] ??= []).push(t.path);
    }
    for (const k in files) files[k]!.sort((a, b) => regionRank(a) - regionRank(b) || a.length - b.length);
    const out: Listing = { version: LIST_VERSION, built: Date.now(), files };
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(out));
    return out;
  }

  function listing(platform: string, kind: LibretroKind) {
    const id = `${platform}/${kind}`;
    let p = cache.get(id);
    // Erro (sem internet, limite da API do GitHub) sobe para quem chamou e não fica guardado: tenta de novo depois.
    if (!p) { p = build(platform, kind).catch(e => { cache.delete(id); throw e; }); cache.set(id, p); }
    return p;
  }

  /** URLs candidatas (melhor região primeiro) para o jogo, ou [] se o acervo não tiver. */
  async function find(platform: string, names: string[], kind: LibretroKind): Promise<string[]> {
    const system = LIBRETRO_SYSTEMS[platform], dir = FOLDER[kind];
    if (!system || !dir) return [];
    const l = await listing(platform, kind);
    if (!l) return [];
    const keys = [...new Set(names.map(key).filter(Boolean))];
    for (const k of keys) {
      const files = Object.hasOwn(l.files, k) ? l.files[k]! : null;
      if (files?.length) return files.slice(0, kind === 'screenshot' ? 4 : 3).map(f => `${raw}/libretro-thumbnails/${repoOf(system)}/master/${dir}/${encodeURIComponent(f)}`);
    }
    return [];
  }

  return { find, supports: (platform: string) => !!LIBRETRO_SYSTEMS[platform] };
}
export type Libretro = ReturnType<typeof createLibretro>;
