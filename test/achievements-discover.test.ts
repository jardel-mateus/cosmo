import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDefs, humanize } from '../src/main/achievements/discover';
import { readRecompFile, recompFiles, recompLocal } from '../src/main/achievements/recomp';

describe('descoberta genérica da lista de conquistas', () => {
  it('nome legível a partir do nome interno', () => {
    expect([humanize('relic_1'), humanize('firstEvo'), humanize('ACH_BEAT_GAME'), humanize('12')]).toEqual(['Relic 1', 'First evo', 'Beat game', 'Conquista 12']);
  });
  it('JSON: lista de objetos e mapa por id, com texto por idioma', () => {
    expect(extractDefs('[{"id":"a","name":{"en":"Alpha","pt-BR":"Alfa"},"description":"x"},{"id":"b","title":"Beta"}]', 'achievements.json')[0])
      .toEqual([{ key: 'a', name: 'Alfa', desc: 'x' }, { key: 'b', name: 'Beta', desc: '' }]);
    expect(extractDefs('{"list":{"a":{"name":"Alpha","desc":"d"},"b":{"name":"Beta"}}}', 'trophies.json')[0]).toEqual([{ key: 'a', name: 'Alpha', desc: 'd' }, { key: 'b', name: 'Beta', desc: '' }]);
  });
  it('HTML, INI e texto com tabulação', () => {
    expect(extractDefs('<ul><li><img src="img/a.png"><b>Alpha</b><small>Do it. Earned today.</small></li><li data-id="b"><h3>Beta</h3></li></ul>', 'page.html')[0])
      .toEqual([{ key: 'a', name: 'Alpha', desc: 'Do it.' }, { key: 'b', name: 'Beta', desc: '' }]);
    expect(extractDefs('[a]\nname = "Alpha"\ndesc = "x"\n[b]\ntitle = Beta\n', 'achievements.ini')[0]).toEqual([{ key: 'a', name: 'Alpha', desc: 'x' }, { key: 'b', name: 'Beta', desc: '' }]);
    expect(extractDefs('1\tbronze\tbase\tFirst Blood\n2\tgold\tbase\tThe End\n', 'trophy-names.txt')[0]).toEqual([{ key: '1', name: 'First Blood', desc: '' }, { key: '2', name: 'The End', desc: '' }]);
  });
  it('recomp sem leitor próprio: acha desbloqueios, a lista com nomes e os ícones sozinho', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cart-disc-'));
    mkdirSync(join(dir, 'user', 'img'), { recursive: true });
    writeFileSync(join(dir, 'game.exe'), '');
    writeFileSync(join(dir, 'user', 'trophies.txt'), '2\n');
    writeFileSync(join(dir, 'user', 'trophy_names.txt'), '1\tbronze\tbase\tFirst Blood\n2\tgold\tbase\tThe End\n');
    writeFileSync(join(dir, 'user', 'img', '2.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const ctx = { installDir: dir, appData: join(dir, 'nada') };
    expect(recompFiles(ctx)).toEqual([join(dir, 'user', 'trophies.txt')]);
    const d = await recompLocal.definitions(ctx);
    expect(d.list).toEqual([{ id: 1, name: 'First Blood', description: '', points: null }, { id: 2, name: 'The End', description: '', points: null }]);
    expect(d.images?.get(2)?.[0]).toBe(0x89);
  });
});

describe('kit rexglue (recomps de Xbox 360)', () => {
  it('desbloqueios: [unlocked.N] com filetime', () => {
    const t = '# Achievement unlock state - managed by ReXGlue runtime\n\n[unlocked.5]\nfiletime = 133500000000000000\n\n[unlocked.12]\nfiletime = 0\n\n';
    expect(readRecompFile(new TextEncoder().encode(t), 'achievements.toml')).toEqual([{ id: 5, at: 133500000000000000 / 10_000 - 11_644_473_600_000 }, { id: 12, at: null }]);
  });
  it('lista: [[achievements]] com id, label e description; não conta como desbloqueio', () => {
    const t = '[[achievements]]\nid = 5\nlabel = "Road Rage"\ndescription = "Takedown 10 cars"\ngamerscore = 20\n\n[[achievements]]\nid = 12\nlabel = "Burnout"\n';
    expect(extractDefs(t, 'achievements.toml')[0]).toEqual([{ key: '5', name: 'Road Rage', desc: 'Takedown 10 cars' }, { key: '12', name: 'Burnout', desc: '' }]);
    expect(readRecompFile(new TextEncoder().encode(t), 'achievements.toml')).toEqual([]);
  });
});

import { indiceAdapter, resolver, usarIndice } from '../src/main/achievements/indice';

describe('índice de conquistas do Cosmo', () => {
  it('resolve marcadores e * no caminho', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cart-idx-'));
    mkdirSync(join(dir, 'save', 'E0001'), { recursive: true });
    writeFileSync(join(dir, 'save', 'E0001', 'achievements.txt'), '1\n');
    expect(resolver('{jogo}/save/*/achievements.txt', { installDir: dir, appData: dir })).toEqual([join(dir, 'save', 'E0001', 'achievements.txt')]);
  });
  it('recomp do índice: acha o perfil fundo, lê os desbloqueios e a lista do jogo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cart-idx-'));
    const prof = join(dir, 'game', 'profiles', 'E000ABCD', '4541080F');
    mkdirSync(prof, { recursive: true });
    writeFileSync(join(prof, 'achievements.toml'), '[unlocked.5]\nfiletime = 133500000000000000\n');
    writeFileSync(join(dir, 'game', 'achievements.toml'), '[[achievements]]\nid = 5\nlabel = "Road Rage"\n\n[[achievements]]\nid = 6\nlabel = "Crash"\n');
    usarIndice({ formato: 1, jogos: [{ repos: ['dono/Projeto-Recomp'], procurar: ['achievements.toml'] }] });
    const ctx = { installDir: dir, appData: join(dir, 'x'), repo: 'Dono/projeto-recomp' };
    expect(indiceAdapter.unlockFile(ctx)).toBe(join(prof, 'achievements.toml'));
    expect(indiceAdapter.readUnlocks(new Uint8Array(Buffer.from('[unlocked.5]\nfiletime = 133500000000000000\n')), ctx).map(u => u.id)).toEqual([5]);
    const d = await indiceAdapter.definitions(ctx);
    expect(d.list.map(a => [a.id, a.name])).toEqual([[5, 'Road Rage'], [6, 'Crash']]);
    usarIndice({ formato: 1, jogos: [] });
  });
});
