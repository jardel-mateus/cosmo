import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));
const gameDir = (files: Record<string, string>) => {
  const d = tmp();
  for (const [f, v] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), v); }
  return d;
};

describe('biblioteca guarda jogos desinstalados', async () => {
  const { openDb } = await import('../src/main/db');
  const { AchievementService, matchKeys } = await import('../src/main/achievements/service');
  afterEach(() => vi.unstubAllGlobals());

  const history = (db: ReturnType<typeof openDb>, id: string) => {
    db.prepare('INSERT INTO play_session (game_id, started_at, ended_at) VALUES (?, 1000, 3601000)').run(id);
    db.prepare('INSERT INTO achievement_unlock (game_id, ach_id, unlocked_at, seen_at) VALUES (?, 7, 5, 5)').run(id);
  };

  it('reconhece pelo appid, id da GOG e nome do .exe (não pelos genéricos)', () => {
    const d = gameDir({ 'steam_settings/steam_appid.txt': '4231820', 'goggame-1207.info': '{"gameId":"1207"}' });
    expect(matchKeys(d, join(d, 'Castlevania.exe'))).toEqual(expect.arrayContaining(['steam:4231820', 'exe:castlevania.exe']));
    expect(matchKeys(tmp(), 'C:\\x\\UnityCrashHandler64.exe')).toEqual([]);
    expect(matchKeys(tmp(), '/x/Game.exe')).toEqual([]);
  });

  it('desinstalar mantém tempo e conquistas; reinstalar em outra pasta volta para a mesma entrada', async () => {
    const db = openDb(':memory:'), svc = new AchievementService(db, tmp());
    const d1 = gameDir({ 'Batman.exe': 'x' });
    const g = await svc.addGame(d1, { exe: join(d1, 'Batman.exe') });
    history(db, g.id);
    svc.rememberKeys(g.id);
    rmSync(d1, { recursive: true });
    svc.markUninstalled(g.id);
    expect(svc.listGames()).toHaveLength(1);
    expect(svc.getGame(g.id)).toMatchObject({ missing: true, uninstalled: true, playMs: 3_600_000 });

    const d2 = gameDir({ 'Batman.exe': 'x' });
    const back = await svc.addGame(d2);
    expect(back.id).toBe(g.id);
    expect(back).toMatchObject({ missing: false, uninstalled: false, installDir: d2, playMs: 3_600_000 });
    expect(db.prepare('SELECT COUNT(*) n FROM achievement_unlock WHERE game_id = ?').get(g.id)).toEqual({ n: 1 });
  });

  it('crack reinstalado (mesmo appid, outro .exe) também é reconhecido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const db = openDb(':memory:'), svc = new AchievementService(db, tmp());
    const d1 = gameDir({ 'steam_appid.txt': '2350790', 'Moonlighter2.exe': 'x' });
    const g = await svc.addGame(d1);
    svc.rememberKeys(g.id);
    rmSync(d1, { recursive: true });
    svc.markUninstalled(g.id);
    const d2 = gameDir({ 'steam_settings/steam_appid.txt': '2350790', 'bin/M2-Win64-Shipping.exe': 'x' });
    expect((await svc.addGame(d2)).id).toBe(g.id);
  });

  it('desinstalado pelo Cosmo com saves na pasta conta como não instalado; reinstalar na mesma pasta reaproveita', async () => {
    const db = openDb(':memory:'), svc = new AchievementService(db, tmp());
    db.prepare("INSERT INTO catalog_game (id, title, repo, console, platform_name, status, first_seen_at, updated_at) VALUES ('recomps/z', 'Z', 'a/z', 'n64', 'N64', 'playable', 0, 0)").run();
    const d = gameDir({ 'Z.exe': 'x', 'saves/slot1.sav': 's' });
    const g = await svc.addGame(d, { catalogId: 'recomps/z', exe: join(d, 'Z.exe'), managed: true });
    history(db, g.id);
    rmSync(join(d, 'Z.exe'));
    svc.markUninstalled(g.id);
    expect(svc.getGame(g.id)).toMatchObject({ missing: true, uninstalled: true });
    writeFileSync(join(d, 'Z.exe'), 'x');
    const back = await svc.addGame(d, { catalogId: 'recomps/z', exe: join(d, 'Z.exe'), managed: true });
    expect(back).toMatchObject({ id: g.id, missing: false, uninstalled: false, playMs: 3_600_000 });
  });

  it('"só tirar da biblioteca" esconde guardando tudo e volta ao adicionar de novo; "apagar tudo" some de vez', async () => {
    const db = openDb(':memory:'), svc = new AchievementService(db, tmp());
    const d = gameDir({ 'Sintopia.exe': 'x' });
    const g = await svc.addGame(d);
    history(db, g.id);
    svc.hideGame(g.id);
    expect(svc.listGames()).toEqual([]);
    const back = await svc.addGame(d);
    expect(back).toMatchObject({ id: g.id, playMs: 3_600_000 });
    expect(svc.listGames()).toHaveLength(1);

    svc.removeGame(g.id);
    const fresh = await svc.addGame(d);
    expect(fresh.id).not.toBe(g.id);
    expect(fresh.playMs).toBe(0);
  });

  it('acha as pastas de saves do crack para "apagar tudo", mesmo depois de desinstalado', async () => {
    const appData = tmp();
    mkdirSync(join(appData, 'GSE Saves', '3784030', 'remote'), { recursive: true });
    const db = openDb(':memory:'), svc = new AchievementService(db, appData);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const d = gameDir({ 'steam_settings/steam_appid.txt': '3784030', 'RACCOIN.exe': 'x' });
    const g = await svc.addGame(d);
    svc.rememberKeys(g.id);
    rmSync(d, { recursive: true });
    svc.markUninstalled(g.id);
    expect(svc.saveDirs(g.id)).toEqual([join(appData, 'GSE Saves', '3784030')]);
  });
});
