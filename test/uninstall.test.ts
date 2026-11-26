import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { planUninstall, within } from '../src/main/uninstall';

const R = resolve('/jogos');
const g = (id: string, installDir: string, exe: string | null = join(installDir, 'jogo.exe'), managed = false) => ({ id, installDir, exe, managed });

describe('desinstalar', () => {
  it('jogo baixado pelo Cosmo apaga só o que veio no download', () => {
    expect(planUninstall(g('a', join(R, 'Zelda'), null, true), [], []).kind).toBe('managed');
  });

  it('jogo numa pasta própria vai inteiro para a Lixeira', () => {
    expect(planUninstall(g('a', join(R, 'Sonic')), [], [])).toEqual({ kind: 'folder', path: join(R, 'Sonic') });
  });

  it('ROM numa pasta com outras: só o arquivo vai para a Lixeira', () => {
    const dir = join(R, 'roms');
    expect(planUninstall(g('a', dir, join(dir, 'mario.sfc')), [], [])).toEqual({ kind: 'file', path: join(dir, 'mario.sfc') });
  });

  it('não apaga pasta ampla, pasta protegida nem pasta de outro jogo', () => {
    expect(planUninstall(g('a', R), [], []).kind).toBe('blocked');
    const home = join(R, 'casa', 'gabri');
    expect(planUninstall(g('a', home), [], [home]).kind).toBe('blocked');
    expect(planUninstall(g('a', join(home, 'Games', 'X')), [], [home]).kind).toBe('folder');
    const pack = join(R, 'Coletanea');
    expect(planUninstall(g('a', pack), [g('b', join(pack, 'Jogo2'))], []).kind).toBe('blocked');
    expect(planUninstall(g('a', join(pack, 'Jogo2')), [g('b', pack)], []).kind).toBe('blocked');
  });

  it('jogo da Steam fica com a própria Steam', () => {
    const lib = mkdtempSync(join(tmpdir(), 'cart-steam-'));
    mkdirSync(join(lib, 'steamapps', 'common', 'Hades'), { recursive: true });
    writeFileSync(join(lib, 'steamapps', 'appmanifest_1145360.acf'), '"AppState"\n{\n "appid" "1145360"\n "name" "Hades"\n "installdir" "Hades"\n}');
    const dir = join(lib, 'steamapps', 'common', 'Hades');
    expect(planUninstall(g('a', dir), [], [])).toEqual({ kind: 'steam', appid: '1145360' });
  });

  it('within compara pastas sem confundir prefixo', () => {
    expect(within(join(R, 'a', 'b'), join(R, 'a'))).toBe(true);
    expect(within(join(R, 'ab'), join(R, 'a'))).toBe(false);
  });
});
