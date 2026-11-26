import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, AdapterContext, Definitions } from './adapters';
import type { Unlock } from './saves';
import { achNet, fetchImages, getJson } from './net';
import { achId } from './steam';
import { tt } from '@shared/i18n';

/** O número do produto na GOG vem do goggame-<número>.info que todo jogo da GOG traz. */
export function gogProductId(dir: string): string | null {
  for (const d of [dir, ...subdirs(dir)]) {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { continue; }
    const f = names.find(n => /^goggame-\d+\.info$/i.test(n));
    if (!f) continue;
    try { const j = JSON.parse(readFileSync(join(d, f), 'utf8')) as { gameId?: string; rootGameId?: string }; if (j.gameId) return String(j.gameId); } catch { }
    return f.match(/\d+/)![0];
  }
  return null;
}
function subdirs(dir: string) { try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).slice(0, 40).map(e => join(dir, e.name)); } catch { return []; } }

interface GogItem { achievement_key: string; name: string; description: string; image_url_unlocked?: string; date_unlocked: string | null; visible?: boolean; rarity?: number }
let cache: { pid: string; at: number; items: GogItem[] } | null = null;
async function items(ctx: AdapterContext): Promise<GogItem[]> {
  const pid = gogProductId(ctx.installDir);
  if (!pid) throw new Error(tt('não achei o goggame-*.info do jogo'));
  if (cache && cache.pid === pid && Date.now() - cache.at < 15_000) return cache.items;
  const t = await achNet.gogToken();
  if (!t) throw new Error(tt('Entre na sua conta da GOG nas configurações (Jogos) para ver as conquistas.'));
  const r = await getJson<{ items?: GogItem[] }>(`https://gameplay.gog.com/clients/${pid}/users/${t.userId}/achievements`, { Authorization: `Bearer ${t.token}` });
  cache = { pid, at: Date.now(), items: r.items ?? [] };
  return cache.items;
}

export const gog: Adapter = {
  id: 'gog',
  label: 'GOG',
  repos: [],
  detect: dir => !!gogProductId(dir),
  async definitions(ctx): Promise<Definitions> {
    const list = await items(ctx);
    if (!list.length) throw new Error(tt('este jogo não tem conquistas na GOG'));
    const images = await fetchImages(new Map(list.flatMap(a => (a.image_url_unlocked ? [[achId(a.achievement_key), a.image_url_unlocked] as [number, string]] : []))));
    return { list: list.map(a => ({ id: achId(a.achievement_key), name: a.name, description: a.description ?? '', points: null })), images, origin: tt('conta da GOG') };
  },
  async rarity(ctx) { const l = (await items(ctx)).filter(a => typeof a.rarity === 'number'); return l.length ? new Map(l.map(a => [achId(a.achievement_key), a.rarity!])) : null; },
  unlockFile: () => '',
  readUnlocks: () => [],
  async remote(ctx): Promise<Unlock[]> {
    return (await items(ctx)).filter(a => a.date_unlocked).map(a => ({ id: achId(a.achievement_key), at: Date.parse(a.date_unlocked!) || null, name: a.achievement_key }));
  },
};
