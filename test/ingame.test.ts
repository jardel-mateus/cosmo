import { describe, expect, it } from 'vitest';
import { Combos, padKeys, rarePage, safeName } from '../src/main/ingame';
import { bindsFor, HOLD, readAllBinds } from '../src/shared/binds';
import { moveTo, ownedBy, xinputButtons } from '../src/main/win32';
import { mergeSessions } from '../src/main/play';

const xbox = (pressed: number[]) => ({ index: 0, id: 'Xbox Wireless Controller', mapping: 'standard', b: Array.from({ length: 18 }, (_, i) => (pressed.includes(i) ? '1' : '0')).join('') });
const ps2 = (pressed: number[]) => ({ index: 1, id: 'Twin USB Joystick (Vendor: 0810 Product: 0001)', mapping: '', b: Array.from({ length: 12 }, (_, i) => (pressed.includes(i) ? '1' : '0')).join('') });

describe('atalhos do controle durante o jogo', () => {
  it('o Cosmo só aparece com o Home segurado por 1 s', () => {
    const c = new Combos();
    expect(c.feed(0, padKeys(xbox([])), 0)).toEqual([]);
    expect(c.feed(0, padKeys(xbox([16])), 100)).toEqual(['arm']);
    expect(c.next(100)).toBe(HOLD);
    expect(c.tick(1000)).toEqual([]);
    expect(c.tick(100 + HOLD)).toEqual(['summon']);
    expect(c.tick(5000)).toEqual([]);
    expect(c.feed(0, padKeys(xbox([])), 5100)).toEqual([]);
    expect(c.feed(0, padKeys(xbox([16])), 6000)).toEqual(['arm']);
    expect(c.feed(0, padKeys(xbox([])), 6400)).toEqual([]);
    expect(c.tick(9000)).toEqual([]);
    expect(c.next(9000)).toBeNull();
    const p = new Combos();
    p.feed(1, padKeys(ps2([])), 0);
    expect([...p.feed(1, padKeys(ps2([8, 9])), 10), ...p.tick(5000)]).not.toContain('summon');
  });

  it('captura no atalho padrão (Home + RB) sem chamar o Cosmo', () => {
    const c = new Combos();
    c.feed(0, padKeys(xbox([])), 0);
    expect(c.feed(0, padKeys(xbox([16])), 10)).toEqual(['arm']);
    expect(c.feed(0, padKeys(xbox([16, 5])), 200)).toEqual(['shot']);
    expect(c.tick(5000)).toEqual([]);
    expect(c.feed(0, padKeys(xbox([16, 5])), 5100)).toEqual([]);
  });

  it('atalhos configurados, inclusive botões extras e adaptador de PS2', () => {
    const all = readAllBinds(JSON.stringify({ summon: ['Home'], 'Xbox Wireless Controller': { summon: ['#17'], shot: ['Select', 'Start'] }, 'Twin USB Joystick (Vendor: 0810 Product: 0001)': { shot: ['Select', 'Start'] } }));
    const c = new Combos(id => bindsFor(all, id));
    c.feed(0, padKeys(xbox([])), 0);
    expect(c.feed(0, padKeys(xbox([8, 9])), 10, 'Xbox Wireless Controller')).toEqual(['shot']);
    expect(c.feed(0, padKeys(xbox([17])), 100, 'Xbox Wireless Controller')).toEqual([]);
    expect(c.tick(100 + HOLD)).toEqual(['summon']);
    c.feed(1, padKeys(ps2([])), 0);
    expect(c.feed(1, padKeys(ps2([8, 9])), 10, 'Twin USB Joystick (Vendor: 0810 Product: 0001)')).toEqual(['shot']);
    c.feed(2, padKeys({ ...xbox([]), index: 2 }), 0, 'Outro controle');
    expect(c.feed(2, padKeys({ ...xbox([16, 5]), index: 2 }), 10, 'Outro controle')).toEqual(['shot']);
    expect(bindsFor(readAllBinds('{"p":{"shot":["#17","x"]}}'), 'p')).toEqual({ summon: ['Home'], shot: ['#17'] });
    expect(bindsFor(readAllBinds('lixo'), 'p').shot).toEqual(['Home', 'RB']);
  });

  it('nome da pasta das capturas sem caracteres proibidos no Windows', () => {
    expect(safeName('Zelda: Majora\'s Mask?')).toBe("Zelda Majora's Mask");
    expect(safeName('...')).toBe('Jogo');
  });

  it('leva a janela do jogo para o monitor do Cosmo', () => {
    const target = { m: [1920, 0, 4480, 1440] as [number, number, number, number], w: [1920, 0, 4480, 1400] as [number, number, number, number] };
    expect(moveTo({ r: [0, 0, 1920, 1080], m: [0, 0, 1920, 1080] }, target)).toEqual([1920, 0, 4480, 1440]);
    expect(moveTo({ r: [100, 100, 1380, 820], m: [0, 0, 1920, 1080] }, target)).toEqual([2560, 340, 3840, 1060]);
    expect(moveTo({ r: [2000, 10, 2400, 300], m: [1920, 0, 4480, 1440] }, target)).toBeNull();
    expect(ownedBy({ pid: 9, path: 'C:\\Games\\Zelda\\bin\\zelda.exe' }, new Set(), ['C:\\Games\\Zelda'])).toBe(true);
    expect(ownedBy({ pid: 9, path: 'C:\\Games\\Zelda2\\z.exe' }, new Set(), ['C:\\Games\\Zelda'])).toBe(false);
    expect(ownedBy({ pid: 9, path: '' }, new Set([9]), [])).toBe(true);
  });
});

describe('XInput lido direto', () => {
  it('converte os bits do XInput no layout padrão, com o botão Xbox', () => {
    const b = xinputButtons(0x0400 | 0x0200);
    expect(padKeys({ index: 100, id: 'x', mapping: 'standard', b: b.map(v => (v ? '1' : '0')).join('') })).toEqual(new Set(['Home', 'RB']));
    expect(xinputButtons(0x1000 | 0x20000).flatMap((v, i) => (v ? [i] : []))).toEqual([0, 7]);
  });
});

describe('sessões de jogo', () => {
  const m = 60_000;
  it('junta sessões com menos de 10 minutos de intervalo', () => {
    const g = mergeSessions([
      { g: 'a', s: 0, e: 30 * m }, { g: 'a', s: 35 * m, e: 60 * m }, { g: 'a', s: 80 * m, e: 81 * m },
      { g: 'b', s: 31 * m, e: 40 * m },
    ]);
    expect(g.map(x => [x.g, x.ms / m])).toEqual([['a', 55], ['a', 1], ['b', 9]]);
  });
});

describe('aviso de conquista rara por cima do jogo', () => {
  it('mostra o nome e a porcentagem; texto da conquista não vira HTML', () => {
    const h = rarePage('<b>Mestre</b> & cia', 'CONQUISTA RARA · 2,4% DOS JOGADORES', null);
    expect(h).toContain('&lt;b&gt;Mestre&lt;/b&gt; &amp; cia');
    expect(h).toContain('CONQUISTA RARA · 2,4% DOS JOGADORES');
    expect(h).toContain('💎');
  });
  it('usa o ícone só quando é uma imagem embutida', () => {
    expect(rarePage('A', 'B', 'data:image/png;base64,iVBORw0KGgo=')).toContain('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(rarePage('A', 'B', 'https://exemplo.com/x.png" onerror="x')).not.toContain('<img');
  });
});
