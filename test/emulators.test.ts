import { describe, expect, it } from 'vitest';
import { createEmulatorResolver, emulatorFor, parseTitle } from '../src/main/emulators';
import { parseWindows } from '../src/main/play';

const name = (exe: string, title: string) => { const e = emulatorFor(exe); return e ? parseTitle(title, e) : null; };

describe('jogo pelo título da janela do emulador', () => {
  it('reconhece os emuladores pelo .exe', () => {
    expect(emulatorFor('C:\\\\Emus\\\\duckstation-qt-x64-ReleaseLTCG.exe')?.consoles).toEqual(['ps1']);
    expect(emulatorFor('Dolphin.exe')?.consoles).toEqual(['gc', 'wii']);
    expect(emulatorFor('notepad.exe')).toBeNull();
  });

  it('tira nome do emulador, versão, FPS, renderizador e códigos do disco', () => {
    expect(name('duckstation-qt.exe', 'Final Fantasy VII (USA) (Disc 1)')).toEqual({ name: 'Final Fantasy VII', consoles: ['ps1'] });
    expect(name('pcsx2-qt.exe', 'Shadow of the Colossus [SCUS-97472] [Vulkan]')?.name).toBe('Shadow of the Colossus');
    expect(name('Dolphin.exe', 'Dolphin 5.0-21088 | JIT64 DC | Direct3D 11 | HLE | Super Mario Sunshine (GMSE01)')?.name).toBe('Super Mario Sunshine');
    expect(name('rpcs3.exe', "RPCS3 0.0.32-16000 | FPS: 30.00 | Vulkan | Demon's Souls [BLUS30443]")?.name).toBe("Demon's Souls");
    expect(name('PPSSPPWindows64.exe', 'PPSSPP v1.17.1 - ULUS10041 : Grand Theft Auto: Liberty City Stories')?.name).toBe('Grand Theft Auto: Liberty City Stories');
    expect(name('Project64.exe', 'Super Mario 64 - Project 64 Version 3.0.1')?.name).toBe('Super Mario 64');
  });

  it('RetroArch: descobre o console pelo núcleo', () => {
    expect(name('retroarch.exe', 'RetroArch Mupen64Plus-Next 2.6 || Super Mario 64')).toEqual({ name: 'Super Mario 64', consoles: ['n64'] });
    expect(name('retroarch.exe', 'RetroArch')).toBeNull();
  });

  it('emulador parado no menu não vira jogo', () => {
    expect(name('duckstation-qt.exe', 'DuckStation')).toBeNull();
    expect(name('Dolphin.exe', 'Dolphin 5.0-21088')).toBeNull();
    expect(name('pcsx2-qt.exe', 'PCSX2 v2.2.0')).toBeNull();
  });
});

describe('cadastro pelo emulador', () => {
  const setup = (known: string[]) => {
    const games: { id: string; title: string; console: string }[] = [{ id: 'g1', title: 'Super Mario Sunshine', console: 'gc' }];
    const ach = { listGames: () => games, addEmulated: (g: { title: string; console: string; exe: string }) => { const n = { id: `novo-${games.length}`, ...g }; games.push(n); return n; } };
    const art = { knows: async (c: string, names: string[]) => known.includes(`${c}:${names[0]}`) };
    return { games, resolve: createEmulatorResolver(ach as never, art as never) };
  };

  it('usa o jogo da biblioteca quando ele já existe', async () => {
    const { resolve } = setup([]);
    expect(await resolve('C:\\Emus\\Dolphin.exe', 'Dolphin 5.0 | JIT64 DC | Super Mario Sunshine (GMSE01)')).toBe('g1');
  });

  it('cadastra quando o LaunchBox conhece o jogo naquela plataforma, e não faz nada quando não conhece', async () => {
    const { games, resolve } = setup(['wii:Super Mario Galaxy']);
    expect(await resolve('C:\\Emus\\Dolphin.exe', 'Dolphin 5.0 | Super Mario Galaxy (RMGE01)')).toBe('novo-1');
    expect(games[1]).toMatchObject({ title: 'Super Mario Galaxy', console: 'wii', exe: 'C:\\Emus\\Dolphin.exe' });
    expect(await resolve('C:\\Emus\\Dolphin.exe', 'Dolphin 5.0 | Meu Homebrew')).toBeNull();
    expect(games).toHaveLength(2);
  });
});

describe('janelas do Windows', () => {
  it('lê PID, caminho e título, mesmo com | no título', () => {
    expect(parseWindows('10|C:\\D\\Dolphin.exe|Dolphin | Zelda\r\n11||\r\n')).toEqual(new Map([[10, { path: 'C:\\D\\Dolphin.exe', title: 'Dolphin | Zelda' }], [11, { path: '', title: '' }]]));
  });
});
