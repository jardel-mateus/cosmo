import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Xdbf, XLanguage } from '../src/main/achievements/xdbf';
import { UnsupportedExecutable, xdbfFromExecutable } from '../src/main/achievements/xex';
import { readHedgeAch, readOxygenAchievements, readRsdkUserdata } from '../src/main/achievements/saves';
import { adapterForDir, adapterForRepo, marathonRecomp, rsdkv4, sonic3air, unleashedRecomp } from '../src/main/achievements/adapters';
import { SONIC3AIR } from '../src/main/achievements/data/sonic3air';
import { SONIC1_2013, SONIC2_2013 } from '../src/main/achievements/data/rsdk4';
import { buildDecryptedImage, buildHedgeAch, buildOxygen, buildUData, buildXdbf, buildXex2, PNG, type FakeAch } from './fixtures';

const ACHS: FakeAch[] = [
  { id: 1, name: 'Speed Freak', desc: 'Clear a stage in under a minute', gs: 10, imageId: 3 },
  { id: 2, name: 'Werehog’s Night', desc: 'Win 50 fights', gs: 25, imageId: 4 },
  { id: 3, name: 'Ring Hoarder', desc: 'Hold 999 rings', gs: 50, imageId: 5 },
];
const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));

describe('XDBF', () => {
  it('lê conquistas, pontos, textos e ícones', () => {
    const x = new Xdbf(buildXdbf(ACHS));
    expect(x.defaultLanguage()).toBe(XLanguage.English);
    const t = x.achievementTexts();
    expect(t.map(a => [a.id, a.name, a.gamerscore])).toEqual([[1, 'Speed Freak', 10], [2, "Werehog's Night", 25], [3, 'Ring Hoarder', 50]]);
    expect(t[0]!.description).toBe('Clear a stage in under a minute');
    expect(x.image(4)).toEqual(PNG);
  });
  it('prefere português quando o jogo tem', () => {
    const x = new Xdbf(buildXdbf(ACHS, { portuguese: { 100: 'Viciado em velocidade', 101: 'Termine uma fase em menos de um minuto' } }));
    const t = x.achievementTexts();
    expect(t[0]!.name).toBe('Viciado em velocidade');
    expect(t[1]!.name).toBe('Conquista 2');   // texto ausente no idioma escolhido
  });
  it('recusa o que não é XDBF', () => { expect(() => new Xdbf(new Uint8Array(32))).toThrow(); });
});

describe('executável do 360', () => {
  const xdbf = buildXdbf(ACHS);
  it('imagem descriptografada do MarathonRecomp (0xDECDECDE)', () => { expect(xdbfFromExecutable(buildDecryptedImage(xdbf))).toEqual(xdbf); });
  it('XEX2 sem compressão', () => { expect(xdbfFromExecutable(buildXex2(xdbf, 0))).toEqual(xdbf); });
  it('XEX2 com compressão básica (blocos com zeros)', () => { expect(xdbfFromExecutable(buildXex2(xdbf, 1))).toEqual(xdbf); });
  it('explica quando o XEX ainda está criptografado', () => {
    expect(() => xdbfFromExecutable(buildXex2(xdbf, 0, { encryption: 1 }))).toThrow(UnsupportedExecutable);
    expect(() => xdbfFromExecutable(buildXex2(xdbf, 0, { encryption: 1 }))).toThrow(/criptografado/);
  });
  it('recusa formato desconhecido', () => { expect(() => xdbfFromExecutable(new Uint8Array(64))).toThrow(UnsupportedExecutable); });
});

describe('arquivos de desbloqueio', () => {
  it('ACH-DATA do hedge-dev, com data', () => {
    const u = readHedgeAch(buildHedgeAch([{ id: 2, time: 1_700_000_000 }, { id: 3, time: 1_700_000_100 }]));
    expect(u).toEqual([{ id: 2, at: 1_700_000_000_000 }, { id: 3, at: 1_700_000_100_000 }]);
  });
  it('ACH-DATA com 23 registros (MarathonRecomp)', () => { expect(readHedgeAch(buildHedgeAch([{ id: 7, time: 5 }], 23))).toHaveLength(1); });
  it('ACH-DATA com checksum errado (arquivo no meio da gravação) falha', () => {
    expect(() => readHedgeAch(buildHedgeAch([{ id: 1, time: 1 }], 50, { badChecksum: true }))).toThrow(/checksum/);
  });
  it('Oxygen Engine: só state ≠ 0, sem data', () => {
    expect(readOxygenAchievements(buildOxygen([[0x0001, 1], [0x0002, 0], [0x0010, 1]]))).toEqual([{ id: 1, at: null }, { id: 0x10, at: null }]);
    expect(readOxygenAchievements(buildOxygen([], []))).toEqual([]);
  });
  it('UData.bin: valor 100 = conquistado', () => {
    expect(readRsdkUserdata(buildUData([0, 5, 11]))).toEqual([{ id: 0, at: null }, { id: 5, at: null }, { id: 11, at: null }]);
  });
});

describe('listas embutidas', () => {
  it('Sonic 3 A.I.R. tem 18 conquistas com ids únicos', () => {
    expect(SONIC3AIR).toHaveLength(18);
    expect(new Set(SONIC3AIR.map(a => a.id)).size).toBe(18);
  });
  it('Sonic 1 e 2 (2013) têm 12 cada, ids 0..11', () => {
    for (const l of [SONIC1_2013, SONIC2_2013]) expect(l.map(a => a.id)).toEqual([...Array(12).keys()]);
  });
});

describe('adaptadores', () => {
  it('reconhece pelo repositório', () => {
    expect(adapterForRepo('hedge-dev/UnleashedRecomp')).toBe(unleashedRecomp);
    expect(adapterForRepo('sonic3air/sonic3air')).toBe(sonic3air);
    expect(adapterForRepo('Rubberduckycooly/Sonic-1-2-2013-Decompilation')).toBe(rsdkv4);
    expect(adapterForRepo('Zelda64Recomp/Zelda64Recomp')).toBeNull();
  });

  it('UnleashedRecomp: pasta, lista do patched/default.xex e ACH-DATA no AppData', async () => {
    const dir = tmp(), appData = tmp();
    writeFileSync(join(dir, 'UnleashedRecomp.exe'), '');
    mkdirSync(join(dir, 'patched'));
    writeFileSync(join(dir, 'patched', 'default.xex'), buildXex2(buildXdbf(ACHS), 1));
    expect(adapterForDir(dir)).toBe(unleashedRecomp);
    const ctx = { installDir: dir, appData };
    const defs = await unleashedRecomp.definitions(ctx);
    expect(defs.list.map(a => a.points)).toEqual([10, 25, 50]);
    expect(defs.images?.get(1)).toEqual(PNG);
    expect(unleashedRecomp.unlockFile(ctx)).toBe(join(appData, 'UnleashedRecomp', 'save', 'ACH-DATA'));
    writeFileSync(join(dir, 'portable.txt'), '');
    expect(unleashedRecomp.unlockFile(ctx)).toBe(join(dir, 'save', 'ACH-DATA'));
  });

  it('MarathonRecomp: lista do decrypted/default.bin', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'MarathonRecomp.exe'), '');
    mkdirSync(join(dir, 'decrypted'));
    writeFileSync(join(dir, 'decrypted', 'default.bin'), buildDecryptedImage(buildXdbf(ACHS)));
    expect(adapterForDir(dir)).toBe(marathonRecomp);
    expect((await marathonRecomp.definitions({ installDir: dir, appData: tmp() })).list).toHaveLength(3);
  });

  it('MarathonRecomp sem o jogo instalado: erro explicado', async () => {
    await expect(marathonRecomp.definitions({ installDir: tmp(), appData: tmp() })).rejects.toThrow(/não encontrado/);
  });

  it('Sonic 3 A.I.R.: usa savedata/ ao lado do executável quando existe', () => {
    const dir = tmp(), appData = tmp();
    expect(sonic3air.unlockFile({ installDir: dir, appData })).toBe(join(appData, 'Sonic3AIR', 'storage', 's3air_achievements.bin'));
    mkdirSync(join(dir, 'savedata', 'storage'), { recursive: true });
    writeFileSync(join(dir, 'savedata', 'storage', 's3air_achievements.bin'), buildOxygen([]));
    expect(sonic3air.unlockFile({ installDir: dir, appData })).toBe(join(dir, 'savedata', 'storage', 's3air_achievements.bin'));
  });

  it('RSDKv4: escolhe Sonic 1 ou 2 pelo título', async () => {
    const ctx = (title: string) => ({ installDir: tmp(), appData: tmp(), title });
    expect((await rsdkv4.definitions(ctx('Sonic the Hedgehog 2'))).list[0]!.name).toBe(SONIC2_2013[0]!.name);
    expect((await rsdkv4.definitions(ctx('Sonic the Hedgehog'))).list[0]!.name).toBe(SONIC1_2013[0]!.name);
  });
});
