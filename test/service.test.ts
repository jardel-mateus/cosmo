import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHedgeAch, buildOxygen, buildXdbf, buildXex2 } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));

const entry = (over: Record<string, unknown>) => ({
  entry: 'recomps/x', nombre: 'X', repo: 'a/x', consola: 'x360', consola_nombre: 'Xbox 360', estado: 'playable', version: 'v1', estrellas: 10,
  desc: { en: 'desc' }, arte: { portada: '/unricopie/arte/x.webp' }, ...over,
});
const catalog = (entradas: unknown[]) => new Response(JSON.stringify({ formato: 1, generado: '2026-11-19T00:00:00Z', entradas }), { headers: { etag: '"abc"' } });

describe('banco, catálogo e conquistas', async () => {
  const { openDb, kvGet } = await import('../src/main/db');
  const { refreshCatalog, listCatalog, listRadar, dismissRadar, seeRadar, RADAR_KEEP } = await import('../src/main/catalog');
  const { AchievementService } = await import('../src/main/achievements/service');
  afterEach(() => vi.unstubAllGlobals());

  it('catálogo: primeira carga sem radar; depois avisa novo, status e versão de jogo instalado', async () => {
    const db = openDb(':memory:');
    const fetch = vi.fn().mockResolvedValueOnce(catalog([
      entry({ entry: 'recomps/unleashed', nombre: 'Sonic Unleashed', repo: 'hedge-dev/UnleashedRecomp' }),
      entry({ entry: 'recomps/zelda', nombre: 'Zelda MM', repo: 'Zelda64Recomp/Zelda64Recomp', consola: 'n64', estado: 'experimental' }),
      entry({ entry: 'recomps/gone', nombre: 'Gone', retirado: true }),
      entry({ entry: 'recomps/pokopia', nombre: 'Pokopia', consola: 'switch2', sin_enlace: true }),
      { lixo: true },
    ]));
    vi.stubGlobal('fetch', fetch);
    expect((await refreshCatalog(db)).total).toBe(3);
    expect(listCatalog(db).map(g => g.title)).toEqual(['Pokopia', 'Sonic Unleashed', 'Zelda MM']);
    expect(listCatalog(db, { console: 'switch2' })[0]).toMatchObject({ title: 'Pokopia', noLink: true });
    expect(listCatalog(db, { console: 'n64' })[0]!.coverUrl).toBe('https://recompendium.com/unricopie/arte/x.webp');
    expect(listRadar(db)).toEqual([]);
    expect(kvGet(db, 'catalog.etag')).toBe('"abc"');

    db.prepare("INSERT INTO installed_game (id, catalog_id, title, console, install_dir, added_at) VALUES ('g', 'recomps/unleashed', 'S', 'x360', '/x', 0)").run();
    fetch.mockResolvedValueOnce(catalog([
      entry({ entry: 'recomps/unleashed', nombre: 'Sonic Unleashed', repo: 'hedge-dev/UnleashedRecomp', version: 'v2' }),
      entry({ entry: 'recomps/zelda', nombre: 'Zelda MM', consola: 'n64', estado: 'playable' }),
      entry({ entry: 'recomps/new', nombre: 'Novo' }),
      entry({ entry: 'recomps/pokopia', nombre: 'Pokopia', consola: 'switch2', sin_enlace: true }),
    ]));
    const r = await refreshCatalog(db);
    expect([r.added, r.statusChanged, r.updated]).toEqual([1, 1, 1]);
    expect(listRadar(db).map(e => e.kind).sort()).toEqual(['new', 'up', 'upd']);
    expect(fetch.mock.calls[1]![1].headers['If-None-Match']).toBe('"abc"');

    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await refreshCatalog(db)).changed).toBe(false);

    const [a, b, c] = listRadar(db);
    dismissRadar(db, [a!.id]);
    expect(listRadar(db).map(e => e.id)).toEqual([b!.id, c!.id]);
    seeRadar(db, [b!.id], 1000);
    seeRadar(db, [b!.id], Date.now());
    expect(listRadar(db, 50, 1000 + RADAR_KEEP + 1).map(e => e.id)).toEqual([c!.id]);
  });

  it('catálogo: Xbox, NES, Game Boy, Mega Drive e DS têm lugar próprio; a biblioteca acompanha', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO catalog_game (id, title, console, platform_name, status, first_seen_at, updated_at) VALUES ('recomps/halo', 'Halo', 'other', 'Xbox', 'play', 0, 0)").run();
    db.prepare("INSERT INTO installed_game (id, catalog_id, title, console, install_dir, added_at) VALUES ('g', 'recomps/halo', 'Halo', 'other', '/x', 0)").run();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(catalog([
      entry({ entry: 'recomps/halo', nombre: 'Halo', consola: 'xbox', consola_nombre: 'Xbox' }),
      entry({ entry: 'recomps/mz', nombre: 'Zero Mission', consola: 'gba', consola_nombre: 'Game Boy Advance' }),
      entry({ entry: 'recomps/la', nombre: 'Links Awakening DX', consola: 'gbc', consola_nombre: 'Game Boy Color' }),
      entry({ entry: 'recomps/s3', nombre: 'Sonic CD', consola: 'megacd', consola_nombre: 'Mega CD' }),
      entry({ entry: 'recomps/ph', nombre: 'Phantom Hourglass', consola: 'nds' }),
      entry({ entry: 'recomps/smb', nombre: 'Super Mario Bros.', consola: 'nes' }),
      entry({ entry: 'recomps/oot3d', nombre: 'Ocarina 3D', consola: '3ds', consola_nombre: 'Nintendo 3DS' }),
    ])));
    await refreshCatalog(db);
    const by = Object.fromEntries(listCatalog(db).map(g => [g.id, g.console]));
    expect(by).toEqual({ 'recomps/halo': 'xbox', 'recomps/mz': 'gb', 'recomps/la': 'gb', 'recomps/s3': 'megadrive', 'recomps/ph': 'nds', 'recomps/smb': 'nes', 'recomps/oot3d': 'other' });
    expect(new AchievementService(db, '/tmp').getGame('g')).toMatchObject({ console: 'xbox', platformName: 'Xbox' });
    expect(listCatalog(db, { consoles: ['other', 'gb'] }).map(g => g.id).sort()).toEqual(['recomps/la', 'recomps/mz', 'recomps/oot3d']);
  });

  it('UnleashedRecomp: adiciona pela pasta, casa com o catálogo, lê lista e desbloqueios, avisa os novos', async () => {
    const db = openDb(':memory:'), appData = tmp(), dir = join(tmp(), 'UnleashedRecomp');
    db.prepare("INSERT INTO catalog_game (id, title, repo, console, platform_name, status, first_seen_at, updated_at) VALUES ('recomps/unleashed', 'Sonic Unleashed', 'hedge-dev/UnleashedRecomp', 'x360', 'Xbox 360', 'full', 0, 0)").run();
    mkdirSync(join(dir, 'patched'), { recursive: true });
    writeFileSync(join(dir, 'UnleashedRecomp.exe'), '');
    writeFileSync(join(dir, 'patched', 'default.xex'), buildXex2(buildXdbf([
      { id: 24, name: 'A', desc: 'a', gs: 10, imageId: 1 }, { id: 25, name: 'B', desc: 'b', gs: 20, imageId: 2 }, { id: 26, name: 'C', desc: 'c', gs: 30, imageId: 3 },
    ]), 0));
    const save = join(appData, 'UnleashedRecomp', 'save');
    mkdirSync(save, { recursive: true });
    writeFileSync(join(save, 'ACH-DATA'), buildHedgeAch([{ id: 24, time: 1_700_000_000 }]));

    const svc = new AchievementService(db, appData);
    const events: string[] = [];
    svc.events.on('unlock', e => events.push(e.name));
    const g = await svc.addGame(dir);
    expect(g).toMatchObject({ title: 'Sonic Unleashed', console: 'x360', adapter: 'unleashed-recomp', catalogId: 'recomps/unleashed', achievements: { unlocked: 1, total: 3 } });
    expect(events).toEqual([]);

    // 26 e 99 acabaram de ser desbloqueadas (avisa); 25 é antiga e aparece agora (entra calada).
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(save, 'ACH-DATA'), buildHedgeAch([{ id: 24, time: 1_700_000_000 }, { id: 25, time: 1_600_000_000 }, { id: 26, time: now - 5 }, { id: 99, time: now }]));
    expect(await svc.syncUnlocks(g.id)).toEqual([25, 26, 99]);
    expect(events).toEqual(['C', 'Conquista #99']);

    const view = svc.forGame(g.id);
    expect(view.errors).toEqual([]);
    expect(view.list.find(a => a.id === 26)).toMatchObject({ name: 'C', points: 30, unlockedAt: (now - 5) * 1000 });
    expect(view.list.find(a => a.id === 24)!.icon).toMatch(/^data:image\/png;base64,/);
    expect(view.list.at(-1)).toMatchObject({ id: 99, name: 'Conquista #99' });

    writeFileSync(join(save, 'ACH-DATA'), buildHedgeAch([]));
    await svc.syncUnlocks(g.id);
    expect(svc.listGames()[0]!.achievements!.unlocked).toBe(4);

    writeFileSync(join(save, 'ACH-DATA'), buildHedgeAch([{ id: 27, time: 1 }], 50, { badChecksum: true }));
    await svc.syncUnlocks(g.id);
    expect(svc.forGame(g.id).errors[0]).toMatch(/checksum/);

    expect(await svc.addGame(dir)).toMatchObject({ id: g.id });
    svc.removeGame(g.id);
    expect(svc.listGames()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM achievement_unlock').get()).toEqual({ n: 0 });
  });

  it('Sonic 3 A.I.R. sem catálogo nem save ainda; o watcher pega o primeiro desbloqueio', async () => {
    const db = openDb(':memory:'), appData = tmp(), dir = tmp();
    writeFileSync(join(dir, 'Sonic3AIR.exe'), '');
    const svc = new AchievementService(db, appData);
    const g = await svc.addGame(dir);
    expect(g).toMatchObject({ adapter: 'sonic3air', title: 'Sonic 3 A.I.R.', achievements: { unlocked: 0, total: 18 } });
    expect(svc.forGame(g.id).errors).toEqual([]);

    const got = new Promise<string>(res => svc.events.once('unlock', e => res(e.name)));
    mkdirSync(join(appData, 'Sonic3AIR', 'storage'), { recursive: true });
    writeFileSync(join(appData, 'Sonic3AIR', 'storage', 's3air_achievements.bin'), buildOxygen([[0x0001, 1]]));
    expect(await got).toBeTruthy();
    svc.stop();
  }, 10_000);

  it('pasta desconhecida entra sem conquistas', async () => {
    const svc = new AchievementService(openDb(':memory:'), tmp());
    expect(await svc.addGame(tmp())).toMatchObject({ adapter: null, achievements: null });
  });
});
