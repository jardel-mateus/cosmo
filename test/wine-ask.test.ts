import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Download } from '../src/shared/wine';
import { openDb } from '../src/main/db';
import { writePatch } from '../src/main/wine/config';
import { prepareWindows, setAskBeforeDownload, setDownloadAsker } from '../src/main/wine/launch';
import { prefixDir } from '../src/main/steam';

const script = (p: string, body: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); };

describe.skipIf(process.platform !== 'linux')('pergunta antes de baixar', () => {
  const env = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, PATH: process.env.PATH };
  let build = '';
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), 'ask-'));
    process.env.HOME = home;
    process.env.XDG_DATA_HOME = join(home, 'data');
    process.env.PATH = '/usr/bin:/bin';
    script(join(home, 'data', 'Cosmo', 'wine', 'runners', 'wine-teste', 'bin', 'wine'), 'mkdir -p "$WINEPREFIX/drive_c/windows/system32"; touch "$WINEPREFIX/system.reg"');
    script(join(home, 'data', 'Cosmo', 'wine', 'winetricks', 'winetricks'), 'exit 0');
    build = realpathSync(join(home, 'data', 'Cosmo', 'wine', 'runners', 'wine-teste'));
  });
  afterEach(() => { Object.assign(process.env, env); setDownloadAsker(null); });

  it('mostra o que vai baixar, cancela sem criar nada e só pergunta de novo quando falta algo', async () => {
    const db = openDb(':memory:');
    writePatch(db, 'jogo', { runner: 'wine', runnerBuild: build, dxvk: { version: 'off' }, winetricks: ['corefonts'] });
    const asks: Download[][] = [];
    let answer = false;
    setDownloadAsker(async (_t, items) => { asks.push(items); return answer; });
    const run = () => prepareWindows(db, 'jogo', 'Jogo', '/x/jogo.exe', () => {}, () => {});

    await expect(run()).rejects.toThrow(/cancelado/);
    expect(asks[0]!.map(d => d.name)).toEqual(['Componentes do winetricks: corefonts']);
    expect(existsSync(prefixDir('jogo'))).toBe(false);

    answer = true;
    const l = await run();
    expect(l.cmd).toBe(join(build, 'bin', 'wine'));
    expect(asks).toHaveLength(2);

    await run();
    expect(asks).toHaveLength(2);

    writePatch(db, 'jogo', { winetricks: ['corefonts', 'vcrun2022'] });
    setAskBeforeDownload(db, false);
    await run();
    expect(asks).toHaveLength(2);
  });
});
