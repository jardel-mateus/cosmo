import { describe, expect, it } from 'vitest';
import { orderLibrary, RECENT_MAX } from '../src/shared/library';

const DAY = 86400_000, NOW = 1_800_000_000_000;
const g = (title: string, lastPlayed: number | null, extra: { running?: boolean; missing?: boolean } = {}) =>
  ({ title, installed: { lastPlayed, running: extra.running ?? false, missing: extra.missing ?? false } });

describe('ordem da biblioteca: jogados recentemente e coleção', () => {
  it('recentes do mais novo para o mais antigo, depois a coleção em ordem alfabética', () => {
    const { list, recent } = orderLibrary([g('Zelda', null), g('Moonlighter 2', NOW - 2 * DAY), g('Ape Escape', null), g('Castlevania', NOW - DAY), g('banjo', null)], NOW);
    expect(recent).toBe(2);
    expect(list.map(x => x.title)).toEqual(['Castlevania', 'Moonlighter 2', 'Ape Escape', 'banjo', 'Zelda']);
  });

  it('jogado há mais de 60 dias vai para a coleção; o jogo aberto agora vem primeiro', () => {
    const { list, recent } = orderLibrary([g('Antigo', NOW - 90 * DAY), g('Ontem', NOW - DAY), g('Aberto', NOW - 200 * DAY, { running: true })], NOW);
    expect(recent).toBe(2);
    expect(list.map(x => x.title)).toEqual(['Aberto', 'Ontem', 'Antigo']);
  });

  it('desinstalado não entra nos recentes e fica no fim da coleção', () => {
    const { list, recent } = orderLibrary([g('Apagado', NOW - DAY, { missing: true }), g('Bom', null), g('Agora', NOW)], NOW);
    expect(recent).toBe(1);
    expect(list.map(x => x.title)).toEqual(['Agora', 'Bom', 'Apagado']);
  });

  it(`no máximo ${RECENT_MAX} recentes; números em ordem natural`, () => {
    const games = Array.from({ length: 9 }, (_, i) => g(`Jogo ${i + 1}`, NOW - i * 1000));
    const { list, recent } = orderLibrary(games, NOW);
    expect(recent).toBe(RECENT_MAX);
    expect(list.slice(RECENT_MAX).map(x => x.title)).toEqual(['Jogo 7', 'Jogo 8', 'Jogo 9']);
    expect(orderLibrary([g('Jogo 10', null), g('Jogo 9', null)], NOW).list.map(x => x.title)).toEqual(['Jogo 9', 'Jogo 10']);
  });

  it('jogos do catálogo sem instalação ficam na coleção', () => {
    const { list, recent } = orderLibrary([{ title: 'B', installed: null }, g('A', NOW)], NOW);
    expect(recent).toBe(1);
    expect(list.map(x => x.title)).toEqual(['A', 'B']);
  });
});

describe('grade com jogados recentemente em cima', async () => {
  const { gridStep } = await import('../src/shared/library');
  // 3 recentes (linha 0) e 8 na coleção em 6 colunas (linhas 1 e 2).
  const step = (i: number, d: 'L' | 'R' | 'U' | 'D') => gridStep(i, 11, 6, 3, d);
  it('anda dentro de cada parte e não passa de uma para a outra pelos lados', () => {
    expect(step(0, 'R')).toBe(1);
    expect(step(2, 'R')).toBeNull();
    expect(step(3, 'L')).toBeNull();
    expect(step(7, 'R')).toBe(8);
    expect(step(8, 'R')).toBeNull();
  });
  it('desce dos recentes para a coleção na mesma coluna (ou na última que existe)', () => {
    expect(step(1, 'D')).toBe(4);
    expect(gridStep(5, 7, 6, 6, 'D')).toBe(6);
    expect(step(4, 'D')).toBe(10);
    expect(step(5, 'D')).toBe(10);
    expect(step(10, 'D')).toBeNull();
  });
  it('sobe da coleção para os recentes e dos recentes para o topo', () => {
    expect(step(7, 'U')).toBe(2);
    expect(step(3, 'U')).toBe(0);
    expect(step(9, 'U')).toBe(3);
    expect(step(1, 'U')).toBe('top');
  });
  it('sem recentes funciona como a grade de antes', () => {
    expect(gridStep(2, 10, 6, 0, 'D')).toBe(8);
    expect(gridStep(4, 10, 6, 0, 'D')).toBe(9);
    expect(gridStep(8, 10, 6, 0, 'U')).toBe(2);
    expect(gridStep(2, 10, 6, 0, 'U')).toBe('top');
  });
});
