import { cleanPatch, mergeConfig, type WineConfig, type WinePatch } from '@shared/wine';
import { type DB, kvGet, kvSet } from '../db';

const key = (gameId: string | null) => (gameId ? `wine.cfg.${gameId}` : 'wine.cfg');

export function readPatch(db: DB, gameId: string | null): WinePatch {
  try {
    const patch = cleanPatch(JSON.parse(kvGet(db, key(gameId)) ?? '{}'));
    if (!gameId) delete patch.prefixPath;
    return patch;
  } catch { return {}; }
}

export const loadConfig = (db: DB, gameId: string): WineConfig => mergeConfig(readPatch(db, null), readPatch(db, gameId));

export function writePatch(db: DB, gameId: string | null, patch: unknown) {
  const old = readPatch(db, gameId), p = cleanPatch(patch);
  const next: WinePatch = { ...old, ...p };
  if (p.dxvk) next.dxvk = { ...old.dxvk, ...p.dxvk };
  if (p.vkd3d) next.vkd3d = { ...old.vkd3d, ...p.vkd3d };
  if (!gameId) delete next.prefixPath;
  kvSet(db, key(gameId), JSON.stringify(next));
  return gameId ? loadConfig(db, gameId) : mergeConfig(next);
}

export const resetGame = (db: DB, gameId: string) => { db.prepare('DELETE FROM kv WHERE key = ?').run(key(gameId)); };
