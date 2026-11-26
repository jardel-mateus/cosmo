import { describe, expect, it } from 'vitest';
import { followAlive, parseProcTable, parseTasklist, type Proc } from '../src/main/play';

describe('parseTasklist', () => {
  it('agrupa os PIDs pelo nome do executável, sem diferenciar maiúsculas', () => {
    const csv = '"System Idle Process","0","Services","0","8 K"\r\n"Zelda64Recompiled.exe","4120","Console","1","512.000 K"\r\n"zelda64recompiled.exe","5000","Console","1","10 K"\r\n"explorer.exe","900","Console","1","90.000 K"\r\n';
    const m = parseTasklist(csv);
    expect(m.get('zelda64recompiled.exe')).toEqual([4120, 5000]);
    expect(m.get('explorer.exe')).toEqual([900]);
  });

  it('ignora linhas que não são de processo', () => {
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n').size).toBe(0);
  });
});

describe('followAlive', () => {
  const dir = 'C:\\Jogos\\Zelda';
  const table: Proc[] = [
    { pid: 10, ppid: 1, path: 'C:\\Windows\\explorer.exe' },
    { pid: 20, ppid: 5, path: 'C:\\Outro\\emu.exe' },
    { pid: 21, ppid: 20, path: 'C:\\Outro\\helper.exe' },
    { pid: 30, ppid: 10, path: 'C:\\Jogos\\Zelda\\bin\\Game.exe' },
    { pid: 40, ppid: 10, path: 'C:\\Jogos\\ZeldaMod\\x.exe' },
  ];

  it('segue os filhos de um launcher que já fechou e os netos deles', () => {
    expect(followAlive(table, new Set([5]), []).sort()).toEqual([20, 21]);
  });

  it('acha o jogo pela pasta, sem pegar uma pasta vizinha com nome parecido', () => {
    expect(followAlive(table, new Set([999]), [dir])).toEqual([30]);
  });

  it('acha pelo nome do .exe quando o Windows não mostra o caminho (jogo aberto como administrador)', () => {
    const t: Proc[] = [...table, { pid: 50, ppid: 4, path: '', name: 'Castlevania Belmont\'s Curse.exe' }];
    expect(followAlive(t, new Set(), ['C:\\Outra'], ["castlevania belmont's curse.exe"])).toEqual([50]);
  });

  it('não acha nada quando o jogo fechou de verdade', () => {
    expect(followAlive(table, new Set([999]), ['C:\\Jogos\\Outro'])).toEqual([]);
  });
});

describe('parseProcTable', () => {
  it('lê PID, PID do pai e caminho', () => {
    expect(parseProcTable('7|1|C:\\J\\a.exe|a.exe\r\n')).toEqual([{ pid: 7, ppid: 1, path: 'C:\\J\\a.exe', name: 'a.exe' }]);
    expect(parseProcTable('4|0|\r\n1234|900|C:\\Jogos\\Zelda\\Game.exe\r\nlixo\r\n')).toEqual([
      { pid: 4, ppid: 0, path: '' },
      { pid: 1234, ppid: 900, path: 'C:\\Jogos\\Zelda\\Game.exe' },
    ]);
  });
});
