import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/main/db';
import { GameInfoService, igdbHasExact, matchIgdb, parseScore, pickIgdb, pickScore, steamAppId, ttbHours, tidyTtb, type WdEntity } from '../src/main/artwork/info';
import type { Artwork } from '../src/main/artwork/service';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));
const item = (id: string) => ({ datavalue: { value: { id } } });
const str = (v: string) => ({ datavalue: { value: v } });
const review = (v: string, by: string, platform?: string) => ({ mainsnak: str(v), rank: 'normal', qualifiers: { P447: [item(by)], ...(platform ? { P400: [item(platform)] } : {}) } });

const OOT: WdEntity = {
  id: 'Q213911', labels: { en: { value: 'The Legend of Zelda: Ocarina of Time' } },
  claims: {
    P400: [{ mainsnak: item('Q184839') }, { mainsnak: item('Q182172') }],
    P444: [review('99/100', 'Q150248', 'Q184839'), review('10/10', 'Q45836', 'Q184839')],
  },
};
const OOT3D: WdEntity = { id: 'Q642526', labels: { en: { value: 'The Legend of Zelda: Ocarina of Time 3D' } }, claims: { P400: [{ mainsnak: item('Q203597') }], P444: [review('94/100', 'Q150248')] } };
const REMAKE: WdEntity = {
  id: 'Q140140365', labels: { mul: { value: 'The Legend of Zelda: Ocarina of Time' } },
  claims: { P400: [{ mainsnak: item('Q122761124') }], P444: [review('96/100', 'Q21039459'), review('99%', 'Q21039459')], P2864: [{ mainsnak: str('20000') }] },
};
const LABELS = { Q184839: 'Nintendo 64', Q182172: 'GameCube', Q203597: 'Nintendo 3DS', Q122761124: 'Nintendo Switch 2' };

describe('nota da crítica pelo Wikidata', () => {
  it('lê 99/100, 99 e ignora porcentagem', () => {
    expect(parseScore('99/100')).toBe(99);
    expect(parseScore('87')).toBe(87);
    expect(parseScore('99%')).toBeNull();
    expect(parseScore('8.5/10')).toBeNull();
  });

  it('escolhe o jogo da plataforma certa e a nota do Metacritic dessa plataforma', () => {
    expect(pickScore("Zelda: Ocarina of Time", 'n64', [OOT, OOT3D, REMAKE], LABELS))
      .toEqual({ value: 99, by: 'Metacritic', url: 'https://www.metacritic.com/search/The%20Legend%20of%20Zelda%3A%20Ocarina%20of%20Time/', platform: 'Nintendo 64', via: 'Wikidata' });
  });

  it('o remake de Switch 2 não pega o 99 do original: usa o OpenCritic dele', () => {
    expect(pickScore('The Legend of Zelda: Ocarina of Time (2026)', 'switch2', [OOT, OOT3D, REMAKE], LABELS))
      .toEqual({ value: 96, by: 'OpenCritic', url: 'https://opencritic.com/game/20000/-', platform: null, via: 'Wikidata' });
  });

  it('sem plataforma conhecida: só aceita nome igual', () => {
    expect(pickScore('The Legend of Zelda: Ocarina of Time', null, [OOT3D, OOT], LABELS)?.value).toBe(99);
    expect(pickScore('Outro jogo', null, [OOT3D, OOT], LABELS)).toBeNull();
  });
});

describe('jogo da Steam pelo .exe', () => {
  it('acha o appid pelo appmanifest da pasta steamapps', () => {
    const root = tmp(), apps = join(root, 'steamapps'), game = join(apps, 'common', 'Hollow Knight');
    mkdirSync(game, { recursive: true });
    writeFileSync(join(apps, 'appmanifest_367520.acf'), '"AppState"\n{\n\t"appid"\t\t"367520"\n\t"name"\t\t"Hollow Knight"\n\t"installdir"\t\t"Hollow Knight"\n}\n');
    writeFileSync(join(apps, 'appmanifest_1.acf'), '"AppState"\n{\n\t"appid"\t\t"1"\n\t"installdir"\t\t"Outro"\n}\n');
    expect(steamAppId(game, join(game, 'hollow_knight.exe'))).toBe('367520');
  });

  it('usa o steam_appid.txt quando existe e devolve null fora da Steam', () => {
    const d = tmp(); writeFileSync(join(d, 'steam_appid.txt'), '620\n');
    expect(steamAppId(d, join(d, 'portal2.exe'))).toBe('620');
    expect(steamAppId(tmp(), null)).toBeNull();
  });
});

describe('informações do jogo', () => {
  const art = (overview: string | null, ready = true) => ({ indexReady: async () => ready, info: async () => (overview ? { overview, developer: 'Team Cherry', year: 2017 } : null), notify: () => {} }) as unknown as Artwork;
  const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('guarda no banco e avisa quando chega; a Steam traz sinopse em português e o Metacritic', async () => {
    const root = tmp(), apps = join(root, 'steamapps'), game = join(apps, 'common', 'Hollow Knight');
    mkdirSync(game, { recursive: true });
    writeFileSync(join(apps, 'appmanifest_367520.acf'), '"appid" "367520"\n"installdir" "Hollow Knight"\n');
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      if (url.includes('steampowered')) return respond({ 367520: { success: true, data: { short_description: 'Explore cavernas &amp; lute.', developers: ['Team Cherry'], release_date: { date: '24 fev. 2017' }, metacritic: { score: 87, url: 'https://www.metacritic.com/game/pc/hollow-knight?ftag=x' } } } });
      throw new Error('não devia ir ao Wikidata');
    }) as never;
    let notified = 0;
    const a = { indexReady: async () => true, info: async () => ({ overview: 'English text', developer: null, year: null }), notify: () => { notified++; } } as unknown as Artwork;
    const svc = new GameInfoService(openDb(':memory:'), fetch, a);
    const input = { console: 'pc', title: 'Hollow Knight', installDir: game, exe: join(game, 'hollow_knight.exe') };
    expect(svc.get(input)).toMatchObject({ overview: null, score: null });
    await new Promise(r => setTimeout(r, 100));
    expect(notified).toBe(1);
    expect(svc.get(input)).toEqual({ overview: 'Explore cavernas & lute.', lang: 'pt', developer: 'Team Cherry', year: 2017, lbPending: false, ttb: null, score: { value: 87, by: 'Metacritic', url: 'https://www.metacritic.com/game/pc/hollow-knight', platform: 'PC', via: 'Steam' } });
    expect(urls).toHaveLength(1);
  });

  it('fora da Steam: sinopse do LaunchBox em inglês e nota do Wikidata', async () => {
    const fetch = (async (url: string) => {
      if (url.includes('wbsearchentities')) return respond({ search: [{ id: 'Q213911', description: '1998 video game for the Nintendo 64' }, { id: 'Q3987974', description: '1998 video game soundtrack' }] });
      if (url.includes('props=labels|claims')) return respond({ entities: { Q213911: OOT } });
      if (url.includes('props=labels')) return respond({ entities: { Q184839: { id: 'Q184839', labels: { en: { value: 'Nintendo 64' } } }, Q182172: { id: 'Q182172', labels: { en: { value: 'GameCube' } } } } });
      throw new Error(url);
    }) as never;
    const svc = new GameInfoService(openDb(':memory:'), fetch, art('Link travels through time.'));
    expect(await svc.lookup({ console: 'n64', title: 'Zelda: Ocarina of Time' })).toEqual({
      overview: 'Link travels through time.', lang: 'en', developer: 'Team Cherry', year: 2017, lbPending: false,
      score: { value: 99, by: 'Metacritic', url: expect.stringContaining('metacritic.com/search/'), platform: 'Nintendo 64', via: 'Wikidata' },
    });
  });

  it('não espera o banco do LaunchBox baixar para mostrar a nota, e completa a sinopse depois sem buscar a nota de novo', async () => {
    let calls = 0;
    const fetch = (async (url: string) => {
      calls++;
      if (url.includes('wbsearchentities')) return respond({ search: [{ id: 'Q213911', description: '1998 video game' }] });
      if (url.includes('props=labels|claims')) return respond({ entities: { Q213911: OOT } });
      return respond({ entities: { Q184839: { id: 'Q184839', labels: { en: { value: 'Nintendo 64' } } } } });
    }) as never;
    const first = await new GameInfoService(openDb(':memory:'), fetch, art('Link travels through time.', false)).lookup({ console: 'n64', title: 'Zelda: Ocarina of Time' });
    expect(first).toMatchObject({ overview: null, lbPending: true, score: { value: 99 } });
    const n = calls;
    const later = await new GameInfoService(openDb(':memory:'), fetch, art('Link travels through time.')).lookup({ console: 'n64', title: 'Zelda: Ocarina of Time' }, first);
    expect(later).toMatchObject({ overview: 'Link travels through time.', lbPending: false, score: { value: 99 } });
    expect(calls).toBe(n);
  });
});

describe('notas prontas do catálogo', () => {
  it('jogo do catálogo mostra a nota na hora, sem consultar o Wikidata', async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => { urls.push(url); throw new Error('sem rede'); }) as never;
    const a = { indexReady: async () => true, info: async () => null, notify: () => {} } as unknown as Artwork;
    const svc = new GameInfoService(openDb(':memory:'), fetch, a);
    svc.setNotas({ jogos: { 'recomps/sm64': { n: { value: 94, by: 'Metacritic', url: null, platform: 'Nintendo 64', via: 'Wikidata' }, t: 1 }, 'recomps/sem': { n: null, t: 1 } } });
    expect(svc.get({ console: 'n64', title: 'Super Mario 64', catalogId: 'recomps/sm64' }).score).toMatchObject({ value: 94 });
    expect(svc.get({ console: 'n64', title: 'Sem Nota', catalogId: 'recomps/sem' }).score).toBeNull();
    await new Promise(r => setTimeout(r, 50));
    expect(urls.filter(u => u.includes('wikidata'))).toEqual([]);
  });

  it('baixa o arquivo de notas e guarda para usar sem internet', async () => {
    const db = openDb(':memory:');
    const body = JSON.stringify({ gerado: 'x', jogos: { 'recomps/sm64': { n: { value: 94, by: 'Metacritic', url: null, platform: null, via: 'Wikidata' }, t: 1 } } });
    const fetch = (async () => new Response(body, { status: 200, headers: { etag: '"a"' } })) as never;
    const a = { indexReady: async () => false, info: async () => null, notify: () => {} } as unknown as Artwork;
    await new GameInfoService(db, fetch, a).startNotas();
    const offline = new GameInfoService(db, (async () => { throw new Error('sem rede'); }) as never, a);
    await offline.startNotas();
    expect(offline.get({ console: 'n64', title: 'Super Mario 64', catalogId: 'recomps/sm64' }).score?.value).toBe(94);
  });
});

describe('média da crítica do IGDB', () => {
  const g = (name: string, rating: number | undefined, count: number, platforms: string[]) => ({ name, aggregated_rating: rating, aggregated_rating_count: count, url: `https://www.igdb.com/games/${name.toLowerCase().replace(/\W+/g, '-')}`, platforms: platforms.map(p => ({ name: p })) });

  it('escolhe a versão da plataforma do console e arredonda', () => {
    const r = pickIgdb('Banjo-Kazooie', 'n64', [g('Banjo-Kazooie: Nuts & Bolts', 79.4, 40, ['Xbox 360']), g('Banjo-Kazooie', 91.6, 12, ['Nintendo 64', 'Xbox 360'])]);
    expect(r).toEqual({ value: 92, by: 'IGDB', url: 'https://www.igdb.com/games/banjo-kazooie', platform: 'Nintendo 64', via: 'IGDB' });
  });

  it('entende os nomes de plataforma do IGDB e ignora quem não tem nota da crítica', () => {
    expect(pickIgdb('Sonic 3 A.I.R.', 'megadrive', [g('Sonic 3 & Knuckles', 90, 5, ['Sega Mega Drive/Genesis'])])?.platform).toBe('Sega Mega Drive/Genesis');
    expect(pickIgdb('DOOM', 'pc', [g('Doom', 89, 9, ['PC (Microsoft Windows)'])])?.value).toBe(89);
    expect(pickIgdb('Banjo-Kazooie', 'n64', [g('Banjo-Kazooie', undefined, 0, ['Nintendo 64'])])).toBeNull();
  });
});

describe('tempo para zerar', () => {
  it('acha o jogo do IGDB pela plataforma, mesmo sem nota da crítica', () => {
    const games = [{ id: 3, name: 'Super Mario 64 DS', platforms: [{ name: 'Nintendo DS' }] }, { id: 2, name: 'Super Mario 64', platforms: [{ name: 'Nintendo 64' }] }];
    expect(matchIgdb('Super Mario 64', 'n64', games)?.id).toBe(2);
    expect(matchIgdb('Outro', 'snes', games)).toBeNull();
  });

  it('não pega outro jogo só porque é da mesma plataforma', () => {
    const games = [{ id: 5, name: 'Castlevania Chronicles', platforms: [{ name: 'PlayStation' }] }, { id: 6, name: 'Metal Gear Solid', platforms: [{ name: 'PlayStation' }] }];
    expect(matchIgdb('Silent Hill', 'ps1', games)).toBeNull();
    expect(matchIgdb('Castlevania: Symphony of the Night', 'ps1', games)).toBeNull();
    expect(matchIgdb('Zelda: Majora\'s Mask', 'n64', [{ id: 8, name: 'The Legend of Zelda: Majora\'s Mask', platforms: [{ name: 'Nintendo 64' }] }])?.id).toBe(8);
    expect(matchIgdb('Final Fantasy VII', 'ps1', [{ id: 9, name: 'Final Fantasy VIII', platforms: [{ name: 'PlayStation' }] }])).toBeNull();
    expect(matchIgdb('007 Everything or Nothing', 'xbox', [{ id: 10, name: 'James Bond 007: Everything or Nothing', platforms: [{ name: 'Xbox' }] }])?.id).toBe(10);
    expect(igdbHasExact('Silent Hill', 'ps1', games)).toBe(false);
    expect(igdbHasExact('Silent Hill', 'ps1', [...games, { id: 7, name: 'Silent Hill', platforms: [{ name: 'PlayStation' }] }])).toBe(true);
  });

  it('descarta tempos que não fazem sentido', () => {
    expect(tidyTtb({ h: 3, n: 7, c: 33340 })).toEqual({ h: 3, n: 7 });
    expect(tidyTtb({ n: 16, c: 8.5 })).toEqual({ n: 16 });
    expect(tidyTtb({ h: 20, n: 9, c: 30 })).toEqual({ h: 20, c: 30 });
    expect(tidyTtb({})).toBeNull();
  });

  it('converte segundos em horas, de meia em meia', () => {
    expect(ttbHours({ hastily: 12 * 3600 + 900, normally: 18 * 3600, completely: 0 })).toEqual({ h: 12.5, n: 18 });
    expect(ttbHours({ hastily: 600 })).toEqual({ h: 0.5 });
    expect(ttbHours({})).toBeNull();
  });

  it('o app mostra o tempo do arquivo de notas para jogos do catálogo', () => {
    const a = { indexReady: async () => true, info: async () => null, notify: () => {} } as unknown as Artwork;
    const svc = new GameInfoService(openDb(':memory:'), (async () => { throw new Error('sem rede'); }) as never, a);
    svc.setNotas({ jogos: { 'recomps/meu': { n: null, t: 1, z: { h: 12.5, n: 18, c: 30 } } } });
    expect(svc.get({ console: 'n64', title: 'Banjo-Kazooie', catalogId: 'recomps/meu' }).ttb).toEqual({ h: 12.5, n: 18, c: 30 });
    expect(svc.get({ console: 'n64', title: 'Outro', catalogId: 'recomps/x' }).ttb).toBeNull();
  });
});
