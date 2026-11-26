import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecompFile, recompFiles } from '../src/main/achievements/recomp';
import { achId } from '../src/main/achievements/steam';
import { adapterForDir } from '../src/main/achievements/adapters';

const enc = (s: string) => new TextEncoder().encode(s);

describe('conquistas guardadas pelos próprios recomps', () => {
  it('texto: um id por linha, e "id hora nome"', () => {
    expect(readRecompFile(enc('3\n7\n'), 'trophies.txt')).toEqual([{ id: 3, at: null }, { id: 7, at: null }]);
    expect(readRecompFile(enc('12 1700000000 Hunter of Hunters\n'), 'trophies.txt')).toEqual([{ id: 12, at: 1700000000_000, name: 'Hunter of Hunters' }]);
  });
  it('JSON por linha (trophies.jsonl)', () => {
    expect(readRecompFile(enc('{"id":4,"time":1700000001}\n{"id":5,"time":1700000002,"name":"X"}\n'), 'trophies.jsonl'))
      .toEqual([{ id: 4, at: 1700000001_000 }, { id: 5, at: 1700000002_000, name: 'X' }]);
  });
  it('JSON com lista ou mapa', () => {
    expect(readRecompFile(enc('{"unlocked":[{"id":1,"unlocked_at":1700000000}]}'), 'trophies.json')).toEqual([{ id: 1, at: 1700000000_000 }]);
    expect(readRecompFile(enc('{"ACH_A":{"unlocked":true,"time":1700000000},"ACH_B":{"unlocked":false}}'), 'achievements.json'))
      .toEqual([{ id: achId('ACH_A'), at: 1700000000_000, name: 'ACH_A' }]);
  });
  it('INI: id=hora ou seções com Achieved=1', () => {
    expect(readRecompFile(enc('[earned]\n'), 'achievements.ini')).toEqual([]);
    expect(readRecompFile(enc('5=1700000000\n6=0\n'), 'achievements.ini')).toEqual([{ id: 5, at: 1700000000_000 }]);
  });
  it('acha o arquivo na pasta do jogo e liga o leitor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cart-rc-'));
    mkdirSync(join(dir, 'user'), { recursive: true });
    writeFileSync(join(dir, 'port.exe'), '');
    writeFileSync(join(dir, 'user', 'trophies.txt'), '1\n');
    expect(recompFiles({ installDir: dir, appData: join(dir, 'x') })).toEqual([join(dir, 'user', 'trophies.txt')]);
    expect(adapterForDir(dir)?.id).toBe('recomp-local');
  });
});
