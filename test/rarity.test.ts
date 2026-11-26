import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHedgeAch, buildXdbf, buildXex2 } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));

describe('conquista rara', async () => {
  const { openDb, kvSet } = await import('../src/main/db');
  const { AchievementService } = await import('../src/main/achievements/service');
  const { isRare, fmtPct, RARE_PCT } = await import('../src/shared/rarity');
  const { setLang } = await import('../src/shared/i18n');
  afterEach(() => setLang('pt'));

  it('rara é abaixo de 5% dos jogadores; sem porcentagem não é rara', () => {
    expect(RARE_PCT).toBe(5);
    expect([isRare(0), isRare(0.4), isRare(4.9), isRare(5), isRare(30), isRare(null), isRare(undefined)]).toEqual([true, true, true, false, false, false, false]);
  });

  it('porcentagem escrita como o jogador lê', () => {
    expect([fmtPct(0), fmtPct(0.05), fmtPct(0.8), fmtPct(3.25), fmtPct(12.4)]).toEqual(['<0,1', '<0,1', '0,8', '3,3', '12']);
    setLang('en');
    expect(fmtPct(3.25)).toBe('3.3');
  });

  it('o aviso da conquista leva a porcentagem guardada de jogadores', async () => {
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
    const got: { name: string; rarity: number | null | undefined }[] = [];
    svc.events.on('unlock', e => got.push({ name: e.name, rarity: e.rarity }));
    const g = await svc.addGame(dir);
    kvSet(db, `ach.rarity.${g.id}`, JSON.stringify({ 25: 2.4, 26: 41 }));
    const t = Math.floor(Date.now() / 1000);
    ach([{ id: 24, time: 1_700_000_000 }, { id: 25, time: t }, { id: 26, time: t }]);
    await svc.syncUnlocks(g.id);
    expect(got).toEqual([{ name: 'B', rarity: 2.4 }, { name: 'C', rarity: 41 }]);
    expect(got.filter(x => isRare(x.rarity)).map(x => x.name)).toEqual(['B']);
  });
});
