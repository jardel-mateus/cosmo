import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBinaryKV, writeBinaryKV } from '../src/main/achievements/vdf';
import { achId, crackFiles, parseSchema, parseUserStats, readEmuUnlocks, scanCrack, steamEmu } from '../src/main/achievements/steam';
import { gogProductId } from '../src/main/achievements/gog';
import { adapterForDir } from '../src/main/achievements/adapters';

const tmp = () => mkdtempSync(join(tmpdir(), 'cart-ach-'));
const SCHEMA = writeBinaryKV({
  '620': {
    gamename: 'Portal 2', version: 3,
    stats: {
      '1': { type: 4, id: 1, bits: {
        '0': { name: 'ACH_SURVIVE', bit: 0, display: { name: { english: 'Survive', brazilian: 'Sobreviva', token: 'X' }, desc: { english: 'Stay alive' }, hidden: '0', icon: 'aa.jpg' } },
        '1': { name: 'ACH_WIN', bit: 1, display: { name: { english: 'Win' }, desc: { english: 'Win it' }, hidden: '1', icon: 'bb.jpg' } },
      } },
      '7': { type: 1, name: 'kills' },
    },
  },
});

describe('conquistas de PC', () => {
  it('lê KeyValues binário da Steam (ida e volta)', () => {
    const kv = parseBinaryKV(writeBinaryKV({ a: { b: 'x', n: 5, big: 9007199254740993n } }));
    expect(kv).toEqual({ a: { b: 'x', n: 5, big: 9007199254740993n } });
  });

  it('lista da Steam: nome em português quando tem, e só os stats de conquista', () => {
    const s = parseSchema(SCHEMA);
    expect(s.map(a => [a.api, a.stat, a.bit, a.name])).toEqual([['ACH_SURVIVE', '1', 0, 'Sobreviva'], ['ACH_WIN', '1', 1, 'Win']]);
    expect(s[1]!.hidden).toBe(true);
  });

  it('desbloqueios da Steam: campo de bits e datas por bit', () => {
    const user = writeBinaryKV({ cache: { crc: 123, '1': { data: 0b10, AchievementTimes: { '1': 1700000000 } } } });
    expect(parseUserStats(user, parseSchema(SCHEMA))).toEqual([{ id: achId('ACH_WIN'), at: 1700000000_000, name: 'ACH_WIN' }]);
  });

  it('Goldberg/GSE: achievements.json', () => {
    const buf = new TextEncoder().encode(JSON.stringify({ A: { earned: true, earned_time: 1600000000 }, B: { earned: false, earned_time: 0 } }));
    expect(readEmuUnlocks(buf)).toEqual([{ id: achId('A'), at: 1600000000_000, name: 'A' }]);
  });

  it('CODEX/RUNE: achievements.ini', () => {
    const ini = '[SteamAchievements]\nCount=2\n00000=A\n\n[A]\nAchieved=1\nCurProgress=0\nUnlockTime=1650000000\n\n[B]\nAchieved=0\nUnlockTime=0\n';
    expect(readEmuUnlocks(new TextEncoder().encode(ini))).toEqual([{ id: achId('A'), at: 1650000000_000, name: 'A' }]);
  });

  it('acha o número do jogo na pasta do crack e os arquivos de save', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'bin', 'steam_settings'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'steam_settings', 'steam_appid.txt'), '1145360\n');
    writeFileSync(join(dir, 'bin', 'local_save.txt'), 'saves');
    const info = scanCrack(dir)!;
    expect(info.appid).toBe('1145360');
    const files = crackFiles({ installDir: dir, appData: join(dir, 'Roaming') }, info);
    expect(files).toContain(join(dir, 'Roaming', 'GSE Saves', '1145360', 'achievements.json'));
    expect(files).toContain(join(dir, 'bin', 'saves', '1145360', 'achievements.json'));
    expect(adapterForDir(dir)?.id).toBe('steam-emu');
  });

  it('lista que veio com o crack (steam_settings/achievements.json)', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'steam_settings', 'img'), { recursive: true });
    writeFileSync(join(dir, 'steam_emu.ini'), '[Settings]\nAppId=480\n');
    writeFileSync(join(dir, 'steam_settings', 'img', 'a.jpg'), Buffer.from([0xff, 0xd8, 1]));
    writeFileSync(join(dir, 'steam_settings', 'achievements.json'), JSON.stringify([{ name: 'A', displayName: { english: 'Alpha', brazilian: 'Alfa' }, description: 'd', icon: 'img/a.jpg' }]));
    const d = await steamEmu.definitions({ installDir: dir, appData: dir });
    expect(d.list).toEqual([{ id: achId('A'), name: 'Alfa', description: 'd', points: null }]);
    expect(d.images?.get(achId('A'))?.[0]).toBe(0xff);
  });

  it('jogo da GOG pelo goggame-*.info', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'goggame-1207658924.info'), JSON.stringify({ gameId: '1207658924', name: 'x' }));
    expect(gogProductId(dir)).toBe('1207658924');
    expect(adapterForDir(dir)?.id).toBe('gog');
  });
});

import { matchByPercent, parseCommunityPage } from '../src/main/achievements/steam';

describe('lista pública da Steam, sem chave', () => {
  const html = `<div class="achieveRow "><div class="achieveImgHolder"><img src="https://cdn/a.jpg" width="64"></div>
    <div class="achieveTxtHolder"><div class="achievePercent">52.3%</div><div class="achieveTxt"><h3>Primeiro &amp; único</h3><h5>Comece o jogo</h5></div></div></div>
    <div class="achieveRow "><div class="achieveImgHolder"><img src="https://cdn/b.jpg"></div>
    <div class="achieveTxtHolder"><div class="achievePercent">4.1%</div><div class="achieveTxt"><h3>Zerou</h3><h5></h5></div></div></div>`;
  it('lê nome, descrição, ícone e porcentagem da página', () => {
    expect(parseCommunityPage(html)).toEqual([
      { name: 'Primeiro & único', desc: 'Comece o jogo', icon: 'https://cdn/a.jpg', pct: 52.3 },
      { name: 'Zerou', desc: '', icon: 'https://cdn/b.jpg', pct: 4.1 },
    ]);
  });
  it('casa os nomes de API pela porcentagem e desiste se não bater', () => {
    const rows = parseCommunityPage(html);
    expect(matchByPercent([{ name: 'ACH_END', percent: 4.08 }, { name: 'ACH_START', percent: 52.31 }], rows)?.map(x => [x.api, x.name]))
      .toEqual([['ACH_START', 'Primeiro & único'], ['ACH_END', 'Zerou']]);
    expect(matchByPercent([{ name: 'A', percent: 30 }, { name: 'B', percent: 4 }], rows)).toBeNull();
    expect(matchByPercent([{ name: 'A', percent: 52 }], rows)).toBeNull();
  });
});

import { parseTenoke } from '../src/main/achievements/steam';

describe('crack da TENOKE', () => {
  const ini = '[TENOKE]\r\nid = 2062430 # BALL x PIT\r\n\r\n[ACHIEVEMENTS.complete_graveyards]\r\nicon = "57c5.jpg"\r\nhidden = "0"\r\n\r\n'
    + '[ACHIEVEMENTS.complete_graveyards.name]\r\nenglish = "BONExYARD"\r\nbrazilian = "PÁTIOxÓSSEO"\r\n\r\n[ACHIEVEMENTS.complete_graveyards.desc]\r\nenglish = "Complete the BONExYARD"\r\nbrazilian = "Conclua o PÁTIOxÓSSEO"\r\n';
  it('lista do tenoke.ini, em português quando tem', () => {
    expect(parseTenoke(ini)).toEqual([{ api: 'complete_graveyards', name: 'PÁTIOxÓSSEO', desc: 'Conclua o PÁTIOxÓSSEO', icon: '57c5.jpg' }]);
  });
  it('desbloqueios do SteamData/user_stats.ini', () => {
    const u = '[ACHIEVEMENTS]\r\n"first_evo" = {unlocked = true, time = 1761262906}\r\n"x" = {unlocked = false, time = 0}\r\n';
    expect(readEmuUnlocks(new TextEncoder().encode(u))).toEqual([{ id: achId('first_evo'), at: 1761262906_000, name: 'first_evo' }]);
  });
  it('acha o número do jogo no tenoke.ini, 3 pastas abaixo', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'Balls_Data', 'Plugins', 'x86_64'), { recursive: true });
    writeFileSync(join(dir, 'Balls_Data', 'Plugins', 'x86_64', 'tenoke.ini'), ini);
    expect(scanCrack(dir)).toMatchObject({ appid: '2062430', tenoke: [join(dir, 'Balls_Data', 'Plugins', 'x86_64', 'tenoke.ini')] });
    expect(crackFiles({ installDir: dir, appData: dir }, scanCrack(dir)!)).toContain(join(dir, 'SteamData', 'user_stats.ini'));
  });
});

import { readFileSync as readFix } from 'node:fs';
import { parseCommunitySsr } from '../src/main/achievements/steam';

describe('página nova de conquistas da Steam', () => {
  it('lê nome de API, nome em português, descrição e ícone do JSON embutido', () => {
    const list = parseCommunitySsr(readFix(join(__dirname, 'fixtures-steam-ssr.html'), 'utf8'));
    expect(list.map(a => [a.api, a.name])).toEqual([['1', 'O sangue fala'], ['2', 'Inflamável ou não?']]);
    expect(list[0]!.icon).toMatch(/\.jpg$/);
    expect(parseCommunitySsr('<html></html>')).toEqual([]);
  });
});

import { parseRecompiaHtml, readEarnedTsv, recompiaDir } from '../src/main/achievements/recompia';

describe('Recompia (Pokopia): conquistas da comunidade', () => {
  it('lê o earned.tsv do mod', () => {
    expect(readEarnedTsv(new TextEncoder().encode('fresh_start\t1761262906\r\nlixo\nfirst_habitat\t1761263000\n')))
      .toEqual([{ id: achId('fresh_start'), at: 1761262906_000, name: 'fresh_start' }, { id: achId('first_habitat'), at: 1761263000_000, name: 'first_habitat' }]);
  });
  it('acha config/community_achievements e liga o leitor', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'game', 'config', 'community_achievements'), { recursive: true });
    expect(recompiaDir(dir)).toBe(join(dir, 'game', 'config', 'community_achievements'));
    expect(adapterForDir(dir)?.id).toBe('recompia');
  });
});

describe('Recompia: página que o mod gera', () => {
  it('lê id, nome e descrição de todas, sem o "Earned"', () => {
    const html = '<ul><li><img src="img/relic_1.png" width="56" height="56" alt=""><div><b>Relic Seeker</b><small>Find a relic. Earned 13 Nov 2026.</small></div></li>'
      + '<li class="no"><img src="img/dex_25.png" width="56" height="56" alt=""><div><b>Pok&eacute;dex &amp; Co</b><small>Register 25.</small><progress max="25" value="3"></progress> 3 / 25</div></li></ul>';
    expect(parseRecompiaHtml(html)).toEqual([{ id: 'relic_1', name: 'Relic Seeker', desc: 'Find a relic.' }, { id: 'dex_25', name: 'Pok&eacute;dex & Co', desc: 'Register 25.' }]);
  });
});
