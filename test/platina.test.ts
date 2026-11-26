import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHedgeAch, buildXdbf, buildXex2 } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));

describe('100% das conquistas', async () => {
  const { openDb } = await import('../src/main/db');
  const { AchievementService } = await import('../src/main/achievements/service');

  /** Unleashed Recomp com 3 conquistas na lista (24, 25, 26). */
  const montar = async () => {
    const db = openDb(':memory:'), appData = tmp(), dir = join(tmp(), 'UnleashedRecomp');
    mkdirSync(join(dir, 'patched'), { recursive: true });
    writeFileSync(join(dir, 'UnleashedRecomp.exe'), '');
    writeFileSync(join(dir, 'patched', 'default.xex'), buildXex2(buildXdbf([
      { id: 24, name: 'A', desc: 'a', gs: 10, imageId: 1 }, { id: 25, name: 'B', desc: 'b', gs: 20, imageId: 2 }, { id: 26, name: 'C', desc: 'c', gs: 30, imageId: 3 },
    ]), 0));
    const save = join(appData, 'UnleashedRecomp', 'save');
    mkdirSync(save, { recursive: true });
    const ach = (l: { id: number; time: number }[]) => writeFileSync(join(save, 'ACH-DATA'), buildHedgeAch(l));
    ach([{ id: 24, time: 1_700_000_000 }]);
    const svc = new AchievementService(db, appData);
    const done: { title: string; total: number }[] = [];
    svc.events.on('complete', e => done.push({ title: e.gameTitle, total: e.total }));
    const g = await svc.addGame(dir);
    return { svc, g, ach, done };
  };
  const agora = () => Math.floor(Date.now() / 1000);

  it('comemora uma vez quando a última conquista da lista acaba de sair, e a capa ganha o selo', async () => {
    const { svc, g, ach, done } = await montar();
    expect(svc.getGame(g.id).achievements).toMatchObject({ unlocked: 1, total: 3, complete: false });

    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: agora() - 5 }]);
    await svc.syncUnlocks(g.id);
    expect(done).toEqual([]);

    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: agora() - 5 }, { id: 26, time: agora() }]);
    await svc.syncUnlocks(g.id);
    expect(done).toEqual([{ title: 'UnleashedRecomp', total: 3 }]);
    expect(svc.getGame(g.id).achievements).toMatchObject({ complete: true });

    // Uma conquista fora da lista depois dos 100% não comemora de novo.
    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: agora() - 5 }, { id: 26, time: agora() }, { id: 99, time: agora() }]);
    await svc.syncUnlocks(g.id);
    expect(done).toHaveLength(1);
  });

  it('conquista fora da lista não conta para os 100%', async () => {
    const { svc, g, ach, done } = await montar();
    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: agora() }, { id: 99, time: agora() }, { id: 98, time: agora() }]);
    await svc.syncUnlocks(g.id);
    expect(svc.getGame(g.id).achievements).toMatchObject({ unlocked: 4, total: 3, complete: false });
    expect(done).toEqual([]);
  });

  it('100% chegando de uma vez com conquistas antigas (importadas) ganha o selo, mas sem comemoração', async () => {
    const { svc, g, ach, done } = await montar();
    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: 1_600_000_000 }, { id: 26, time: 1_600_000_001 }]);
    await svc.syncUnlocks(g.id);
    expect(svc.getGame(g.id).achievements).toMatchObject({ complete: true });
    expect(done).toEqual([]);
  });
});
