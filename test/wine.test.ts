import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanPatch, mergeConfig, WINE_DEFAULTS } from '../src/shared/wine';
import { cmpVer, deploy, peBits, pickDxvk, undeploy, DXVK_DLLS } from '../src/main/wine/components';
import { discoverBuilds, ensureDirs, findExecutable, launchArgs, resolveRunner, toolArgs, type Deps } from '../src/main/wine/runner';
import { windowsAppData } from '../src/main/steam';
import { openDb } from '../src/main/db';
import { loadConfig, readPatch, resetGame, writePatch } from '../src/main/wine/config';

let home = '', deps: Deps;
const touch = (p: string, body = '', mode?: number) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); if (mode) chmodSync(p, mode); };
const proton = (root: string, name: string) => touch(join(root, name, 'proton'), '');
const steam = () => join(home, '.local', 'share', 'Steam');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wine-home-'));
  vi.stubEnv('XDG_DATA_HOME', '');
  deps = { home, env: { PATH: '' }, system: false };
});
afterEach(() => vi.unstubAllEnvs());

describe('builds instalados', () => {
  it('prefere o Proton-GE ao da Valve, e o GE mais novo entre os GE', () => {
    proton(join(steam(), 'steamapps', 'common'), 'Proton 9.0');
    proton(join(steam(), 'steamapps', 'common'), 'Proton - Experimental');
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-9');
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    expect(discoverBuilds(deps).map(b => b.name).slice(0, 2)).toEqual(['GE-Proton10-34', 'GE-Proton10-9']);
    expect(discoverBuilds(deps).at(-1)?.family).toBe('valve');
  });

  it('acha Steam em Flatpak e o que o Cosmo baixou, e separa Proton de Wine', () => {
    proton(join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam', 'compatibilitytools.d'), 'GE-Proton9-1');
    touch(join(home, '.local', 'share', 'Cosmo', 'wine', 'runners', 'wine-11.22-amd64-wow64', 'bin', 'wine'), '', 0o755);
    const b = discoverBuilds(deps);
    expect(b.find(x => x.name === 'GE-Proton9-1')?.kind).toBe('proton');
    expect(b.find(x => x.name.startsWith('wine-11.22'))).toMatchObject({ kind: 'wine', where: 'cartucho' });
  });

  it('acha o umu-run em ~/.local/bin mesmo sem ele no PATH', () => {
    expect(findExecutable('umu-run', deps)).toBeNull();
    touch(join(home, '.local', 'bin', 'umu-run'), '#!/bin/sh\n', 0o755);
    expect(findExecutable('umu-run', deps)).toBe(join(home, '.local', 'bin', 'umu-run'));
  });
});

describe('escolha do runner', () => {
  const umu = () => touch(join(home, '.local', 'bin', 'umu-run'), '#!/bin/sh\n', 0o755);

  it('umu usa o GE instalado em PROTONPATH, senão o umu cai no download e falha sem rede', () => {
    umu();
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    const r = resolveRunner('jogo', WINE_DEFAULTS, deps).runner!;
    expect(r.name).toBe('umu');
    expect(r.env.PROTONPATH).toBe(join(steam(), 'compatibilitytools.d', 'GE-Proton10-34'));
    expect(r.env.WINEPREFIX).toBe(join(home, '.local', 'share', 'Cosmo', 'prefixos', 'jogo', 'pfx'));
    expect(r.env.GAMEID).toBe('umu-default');
    expect(resolveRunner('jogo', WINE_DEFAULTS, { ...deps, home: mkdtempSync(join(tmpdir(), 'h-')) }).runner).toBeNull();
  });

  it('sem GE instalado o umu pede o GE-Proton ao próprio umu', () => {
    umu();
    expect(resolveRunner('jogo', WINE_DEFAULTS, deps).runner?.env.PROTONPATH).toBe('GE-Proton');
  });

  it('sem umu usa o Proton direto, com o prefixo do jogo em STEAM_COMPAT_DATA_PATH', () => {
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    const r = resolveRunner('jogo', WINE_DEFAULTS, deps).runner!;
    expect(r.name).toBe('proton');
    expect(r.cmd).toBe(join(steam(), 'compatibilitytools.d', 'GE-Proton10-34', 'proton'));
    expect(r.env.STEAM_COMPAT_DATA_PATH).toBe(join(home, '.local', 'share', 'Cosmo', 'prefixos', 'jogo'));
    expect(launchArgs(r, '/j/a.exe')).toEqual(['run', '/j/a.exe']);
    expect(toolArgs(r, ['wineboot', '-u'])).toEqual(['waitforexitandrun', 'wineboot', '-u']);
  });

  it('um Wine escolhido (Kron4ek) roda direto com o prefixo do jogo, sem passar pelo umu', () => {
    umu();
    const bin = join(home, '.local', 'share', 'Cosmo', 'wine', 'runners', 'wine-11.22-amd64-wow64');
    touch(join(bin, 'bin', 'wine'), '', 0o755);
    const r = resolveRunner('jogo', mergeConfig({ runnerBuild: bin.replace(home, realpathSync(home)) }), deps).runner!;
    expect(r.name).toBe('wine');
    expect(r.cmd.endsWith('/bin/wine')).toBe(true);
    expect(r.env.WINEPREFIX).toContain('/prefixos/jogo/pfx');
    expect(r.env.PATH?.startsWith(join(r.build!.id, 'bin'))).toBe(true);
    expect(launchArgs(r, '/j/a.exe')).toEqual(['/j/a.exe']);
    expect(launchArgs(r, '/j/run.bat')).toEqual(['start', '/unix', '/j/run.bat']);
  });

  it('runner forçado que não existe não cai em outro; build sumida avisa', () => {
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    expect(resolveRunner('j', mergeConfig({ runner: 'umu' }), deps)).toEqual({ runner: null, error: 'umu' });
    expect(resolveRunner('j', mergeConfig({ runner: 'wine' }), deps)).toEqual({ runner: null, error: 'wine' });
    expect(resolveRunner('j', mergeConfig({ runnerBuild: '/nao/existe' }), deps)).toEqual({ runner: null, error: 'build-missing' });
    expect(resolveRunner('j', WINE_DEFAULTS, { ...deps, home: mkdtempSync(join(tmpdir(), 'h-')) })).toEqual({ runner: null, error: 'none' });
  });

  it('prefixo escolhido pelo usuário vale; no Proton direto ele entra como o pfx do jogo', () => {
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    const mine = join(home, 'meu-prefixo');
    const r = resolveRunner('j', mergeConfig({ prefixPath: mine, env: { MANGOHUD: '1' }, sync: 'none' }), deps).runner!;
    expect(r.prefix).toBe(mine);
    expect(r.env.MANGOHUD).toBe('1');
    expect(r.env.PROTON_NO_FSYNC).toBe('1');
    ensureDirs(r);
    expect(lstatSync(join(r.compat!, 'pfx')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(r.compat!, 'pfx'))).toBe(mine);
    ensureDirs(r);
  });

  it('marca primeira execução até o prefixo ter system.reg', () => {
    proton(join(steam(), 'compatibilitytools.d'), 'GE-Proton10-34');
    expect(resolveRunner('j', WINE_DEFAULTS, deps).runner?.firstRun).toBe(true);
    touch(join(home, '.local', 'share', 'Cosmo', 'prefixos', 'j', 'pfx', 'system.reg'));
    expect(resolveRunner('j', WINE_DEFAULTS, deps).runner?.firstRun).toBe(false);
  });
});

describe('configuração', () => {
  it('descarta lixo vindo do banco e guarda só campos válidos', () => {
    expect(cleanPatch({ runner: 'rm -rf', runnerBuild: 'relativo', env: { 'A B': 'x', OK: '1', N: 2 }, dxvk: { version: '3.1.1; ls', async: 'sim' }, winetricks: ['vcrun2022', '$(x)'], sync: 'esync' }))
      .toEqual({ env: { OK: '1' }, dxvk: {}, winetricks: ['vcrun2022'], sync: 'esync' });
  });

  it('o jogo sobrescreve o global; env soma, winetricks une', () => {
    const c = mergeConfig(
      { runner: 'umu', env: { A: '1', B: '1' }, dxvk: { async: true }, winetricks: ['corefonts'] },
      { env: { B: '2' }, dxvk: { version: '3.0' }, winetricks: ['vcrun2022'], prefixPath: '/p' },
    );
    expect(c).toMatchObject({ runner: 'umu', env: { A: '1', B: '2' }, dxvk: { version: '3.0', async: true }, winetricks: ['corefonts', 'vcrun2022'], prefixPath: '/p' });
  });
});

describe('DXVK', () => {
  const list = ['3.1.1', '3.1', '3.0.2', '3.0', '2.7.1', '2.7'];

  it('padrão é o mais novo; sem Vulkan 1.4 cai para o mais novo abaixo da 3.0', () => {
    expect(pickDxvk(list, true, 'auto')).toBe('3.1.1');
    expect(pickDxvk(list, null, 'auto')).toBe('3.1.1');
    expect(pickDxvk(list, false, 'auto')).toBe('2.7.1');
    expect(pickDxvk(list, false, '3.0')).toBe('3.0');
    expect(pickDxvk(list, true, '9.9')).toBeNull();
    expect(cmpVer('3.0.2', '3.0')).toBeGreaterThan(0);
    expect(cmpVer('2.7.1', '3.0')).toBeLessThan(0);
  });

  const pack = (name: string, fill: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    for (const arch of ['x64', 'x32']) for (const d of DXVK_DLLS) touch(join(dir, arch, `${d}.dll`), `${fill}-${arch}`);
    return { dir, name };
  };

  it('instala no prefixo guardando os arquivos originais, troca de versão e desfaz', () => {
    const sys32 = join(home, 'pfx', 'system32'), wow = join(home, 'pfx', 'syswow64'), marker = join(home, 'pfx', '.m.json');
    touch(join(sys32, 'd3d11.dll'), 'wine-original');
    deploy(pack('dxvk-3.0', 'A'), DXVK_DLLS, { x64: sys32, x32: wow }, marker);
    expect(readFileSync(join(sys32, 'd3d11.dll'), 'utf8')).toBe('A-x64');
    expect(readFileSync(join(wow, 'dxgi.dll'), 'utf8')).toBe('A-x32');
    deploy(pack('dxvk-3.1.1', 'B'), DXVK_DLLS, { x64: sys32, x32: wow }, marker);
    expect(readFileSync(join(sys32, 'd3d11.dll'), 'utf8')).toBe('B-x64');
    expect(readFileSync(`${join(sys32, 'd3d11.dll')}.cartucho-bak`, 'utf8')).toBe('wine-original');
    undeploy(marker);
    expect(readFileSync(join(sys32, 'd3d11.dll'), 'utf8')).toBe('wine-original');
    expect(existsSync(join(wow, 'dxgi.dll'))).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it('uma instalação que falha no meio é desfeita e os originais voltam', () => {
    const sys32 = join(home, 'pfx2', 'system32'), marker = join(home, 'pfx2', '.m.json');
    touch(join(sys32, 'd3d9.dll'), 'wine-d3d9');
    touch(join(sys32, 'd3d11.dll'), 'wine-d3d11');
    const p = pack('dxvk-x', 'C');
    const bad = join(p.dir, 'x64', 'd3d11.dll');
    rmSync(bad); mkdirSync(bad);
    expect(() => deploy(p, DXVK_DLLS, { x64: sys32, x32: null }, marker)).toThrow();
    deploy(pack('dxvk-y', 'D'), DXVK_DLLS, { x64: sys32, x32: null }, marker);
    expect(readFileSync(join(sys32, 'd3d11.dll'), 'utf8')).toBe('D-x64');
    undeploy(marker);
    expect(readFileSync(join(sys32, 'd3d9.dll'), 'utf8')).toBe('wine-d3d9');
    expect(readFileSync(join(sys32, 'd3d11.dll'), 'utf8')).toBe('wine-d3d11');
    expect(existsSync(`${join(sys32, 'd3d11.dll')}.cartucho-bak`)).toBe(false);
  });

  it('lê se o .exe é de 32 ou 64 bits', () => {
    const exe = (machine: number) => { const b = Buffer.alloc(256); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80, 'latin1'); b.writeUInt16LE(machine, 0x84); const p = join(home, `x${machine}.exe`); writeFileSync(p, b); return p; };
    expect(peBits(exe(0x14c))).toBe(32);
    expect(peBits(exe(0x8664))).toBe(64);
    expect(peBits(join(home, 'nao-existe.exe'))).toBe(64);
  });
});

describe('save dentro do prefixo', () => {
  it('acha o AppData do Proton (steamuser) ou do Wine (usuário), e o prefixo escolhido primeiro', () => {
    vi.stubEnv('HOME', home);
    vi.stubEnv('WINEPREFIX', '');
    const exe = join(home, 'Jogos', 'Jogo.exe');
    expect(windowsAppData(join(home, 'Jogos'), exe, 'g1')).toBeNull();
    const roaming = (p: string, u: string) => { const r = join(p, 'drive_c', 'users', u, 'AppData', 'Roaming'); mkdirSync(r, { recursive: true }); return r; };
    const own = join(home, '.local', 'share', 'Cosmo', 'prefixos', 'g1', 'pfx');
    const proton1 = roaming(own, 'steamuser');
    expect(windowsAppData(join(home, 'Jogos'), exe, 'g1')).toBe(proton1);
    const mine = roaming(join(home, 'meu'), 'steamuser');
    expect(windowsAppData(join(home, 'Jogos'), exe, 'g1', join(home, 'meu'))).toBe(mine);
  });
});

describe('configuração guardada', () => {
  it('o jogo guarda só o que mudou, sem mexer no padrão; apagar volta ao padrão', () => {
    const db = openDb(':memory:');
    writePatch(db, null, { runner: 'umu', env: { A: '1' }, prefixPath: '/nao-vale-no-padrao' });
    const game = writePatch(db, 'g1', { env: { B: '2' }, dxvk: { async: true } });
    expect(game).toMatchObject({ runner: 'umu', env: { A: '1', B: '2' }, dxvk: { version: 'auto', async: true }, prefixPath: null });
    expect(readPatch(db, 'g1')).toEqual({ env: { B: '2' }, dxvk: { async: true } });
    expect(loadConfig(db, 'g2').dxvk.async).toBe(false);
    resetGame(db, 'g1');
    expect(loadConfig(db, 'g1').env).toEqual({ A: '1' });
  });
});
