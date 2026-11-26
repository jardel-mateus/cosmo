import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { steamManifest } from '../src/main/steam';

describe('jogos da Steam', () => {
  it('pega o nome do jogo no manifesto, não o nome da pasta', () => {
    const lib = join(mkdtempSync(join(tmpdir(), 'steam-')), 'steamapps');
    const dir = join(lib, 'common', 'CONCRETE FUNERAL');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(lib, 'appmanifest_123.acf'), '"AppState"\n{\n\t"appid"\t\t"123"\n\t"name"\t\t"Concrete Burial"\n\t"installdir"\t\t"CONCRETE FUNERAL"\n}\n');
    expect(steamManifest(dir)).toEqual({ appid: '123', name: 'Concrete Burial' });
    expect(steamManifest(join(dir, 'BrutalistHorror.exe'))).toEqual({ appid: '123', name: 'Concrete Burial' });
    expect(steamManifest(join(lib, 'common', 'Outro'))).toBeNull();
  });
});

import { parseWmctrl, winePath } from '../src/main/play';
import { desktopEntry } from '../src/main/background';

describe('Linux', () => {
  it('entende o caminho de um jogo rodando pelo Proton/Wine', () => {
    expect(winePath('Z:\\home\\g\\.local\\share\\Steam\\steamapps\\common\\Jogo\\Jogo.exe')).toBe('/home/g/.local/share/Steam/steamapps/common/Jogo/Jogo.exe');
    expect(winePath('/home/g/Jogo/Jogo.exe')).toBe('/home/g/Jogo/Jogo.exe');
    expect(winePath('C:\\windows\\system32\\steam.exe')).toBeNull();
  });
  it('lê o título das janelas pelo wmctrl', () => {
    const m = parseWmctrl('0x04400003  0 4242   pc DuckStation - Castlevania: Symphony of the Night\n0x0480000a -1 99 pc Painel', new Map([[4242, '/usr/bin/duckstation-qt']]));
    expect(m.get(4242)).toEqual({ path: '/usr/bin/duckstation-qt', title: 'DuckStation - Castlevania: Symphony of the Night' });
    expect(m.has(99)).toBe(false);
  });
  it('gera o atalho .desktop', () => {
    const e = desktopEntry({ name: 'Zelda', comment: 'Zelda pelo Cosmo', args: '--play abc', icon: '/x/icon.png' });
    expect(e).toContain('Name=Zelda');
    expect(e).toMatch(/^Exec=".+" .*--play abc$/m);
  });
});

import { hasBit, PadState } from '../src/main/linux';
import { bindsFor } from '../src/shared/binds';

describe('controle no Linux', () => {
  it('reconhece um controle pelos botões que ele declara', () => {
    expect(hasBit('7cdb000000000000 0 0 0', 0x130)).toBe(false);
    expect(hasBit('7cdb000000000000 0 0 0 0', 0x130)).toBe(true);
  });
  it('converte eventos do evdev no mesmo formato do XInput', () => {
    const s = new PadState(true);
    s.event(1, 0x13c, 1); s.event(1, 0x137, 1);
    expect(s.mask).toBe(0x0400 | 0x0200);
    s.event(3, 0x11, -1); expect(s.mask & 0x0001).toBe(1);
    s.event(3, 0x02, 200); expect(s.mask & 0x10000).toBe(0x10000);
    s.event(1, 0x13c, 0); s.event(3, 0x11, 0); s.event(3, 0x02, 0);
    expect(s.mask).toBe(0x0200);
  });
  it('acha os atalhos do mesmo controle mesmo com outro nome', () => {
    const all = { 'Xbox 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)': { shot: ['Select', 'Start'] } };
    expect(bindsFor(all, 'Microsoft X-Box 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)').shot).toEqual(['Select', 'Start']);
    expect(bindsFor(all, 'Outro (Vendor: 1234 Product: 5678)').shot).toEqual(['Home', 'RB']);
  });
});

import { parseWindows } from '../src/main/linux';

describe('janelas no Linux', () => {
  it('lê a lista de janelas do wmctrl com posição e tamanho', () => {
    const L = parseWindows('0x01e00003  0 4242   100 120 1200 700 pc Jogo Falso\n0x01e00009 -1 99 0 0 1920 30 pc Painel');
    expect(L).toEqual([{ id: 0x01e00003, pid: 4242, x: 100, y: 120, w: 1200, h: 700, title: 'Jogo Falso' }]);
  });
});

import { windowsAppData } from '../src/main/steam';

describe('saves de jogos do Windows no Linux', () => {
  it('acha a pasta AppData do prefixo do Proton', () => {
    const lib = join(mkdtempSync(join(tmpdir(), 'steam-')), 'steamapps');
    const dir = join(lib, 'common', 'Unleashed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(lib, 'appmanifest_99.acf'), '"AppState"\n{\n\t"appid"\t\t"99"\n\t"name"\t\t"Unleashed"\n\t"installdir"\t\t"Unleashed"\n}\n');
    const roaming = join(lib, 'compatdata', '99', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'Roaming');
    mkdirSync(roaming, { recursive: true });
    expect(windowsAppData(dir, join(dir, 'UnleashedRecomp.exe'))).toBe(roaming);
    expect(windowsAppData(dir, join(dir, 'unleashed'))).toBeNull();
  });
});

import { trayMissing } from '../src/main/background';

describe('ícone na bandeja no Linux', () => {
  it('avisa só no GNOME sem a extensão AppIndicator', () => {
    if (process.platform !== 'linux') return;
    expect(trayMissing('ubuntu:GNOME', () => 'ding@rastersoft.com\nubuntu-appindicators@ubuntu.com\n')).toBe(false);
    expect(trayMissing('GNOME', () => 'ding@rastersoft.com\n')).toBe(true);
    expect(trayMissing('KDE', () => '')).toBe(false);
    expect(trayMissing('GNOME', () => null)).toBe(false);
  });
});

import { guessAsset } from '../src/main/ports/github';

describe('jogos do Windows no Linux', () => {
  it('sem versão para Linux, baixa a do Windows para rodar pelo Proton', () => {
    const a = (name: string) => ({ id: 1, name, size: 1, browser_download_url: '' });
    expect(guessAsset([a('Jogo-Windows-x64.zip'), a('Jogo-Linux-x86_64.AppImage')], 'linux')?.name).toBe('Jogo-Linux-x86_64.AppImage');
    expect(guessAsset([a('Jogo-Windows-x64.zip'), a('Jogo-macOS.zip')], 'linux')?.name).toBe('Jogo-Windows-x64.zip');
  });
});
