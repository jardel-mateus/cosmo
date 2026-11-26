import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { semArquivos, tileClick } from '@shared/gameclick';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, PlayStats, RadarEvent } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { useArt } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from '../components/GameArt';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useFeed, useHubActions, useHubData, type HubGame, uninstallMsg } from './data';
import { wheelNav } from './wheel';
import { tt } from '@shared/i18n';

type Tab = 'home' | 'games' | 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type Zone = 'tabs' | 'tiles' | 'list' | 'gacts' | 'gshots' | 'gtext';
interface St { tab: number; zone: Zone; fi: number; li: number; mi: number; dir: 1 | -1; menu: boolean; game: string | null; ai: number; gs: number }
interface Tile { x: number; y: number; w: number; h: number; g?: HubGame; cls?: string; cap: string; sub?: string; big?: boolean; quick?: HubGame[]; txt?: ReactNode; bar?: number; tag?: string; tagCls?: string; go?: Tab; feed?: RadarEvent; idx?: number }
interface Row { key: string; g?: HubGame; ic?: IconName; l: string; v?: string; id?: string }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const TABS: [Tab, string][] = [['home', tt('início')], ['games', tt('jogos')], ['cat', tt('descobrir')], ['news', tt('novidades')], ['ach', tt('conquistas')], ['time', tt('tempo')], ['cfg', tt('ajustes')]];
const CFG: Row[] = [
  { key: 'dir', id: 'dir', l: tt('Pasta dos jogos'), ic: 'folder' }, { key: 'snd', id: 'snd', l: tt('Sons da interface'), ic: 'sound' },
  { key: 'radar', id: 'radar', l: tt('Radar de novidades'), ic: 'bell' }, { key: 'off', id: 'off', l: tt('Voltar ao Cosmo'), ic: 'power' },
];
const FEED = { new: tt('novo no catálogo'), upd: tt('versão nova'), up: tt('mudou de status') } as const;
const PER = 10, LIST_ROWS = 7;

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} done={!!g.installed?.achievements?.complete} />;

function nearest(T: Tile[], fi: number, k: Key) {
  const a = T[fi]; if (!a) return -1;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  let best = -1, bs = 1e9;
  T.forEach((b, j) => {
    if (j === fi) return;
    const dx = b.x + b.w / 2 - ax, dy = b.y + b.h / 2 - ay;
    const ok = k === 'ArrowRight' ? dx > 20 : k === 'ArrowLeft' ? dx < -20 : k === 'ArrowDown' ? dy > 20 : dy < -20;
    if (!ok) return;
    const h = k === 'ArrowRight' || k === 'ArrowLeft';
    const sc = (h ? Math.abs(dx) : Math.abs(dy)) + (h ? Math.abs(dy) : Math.abs(dx)) * 2;
    if (sc < bs) { bs = sc; best = j; }
  });
  return best;
}

export function X360Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const og = id === 'xbox';
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ tab: tab === 'cat' ? 2 : tab === 'lib' ? 1 : 0, zone: 'tiles', fi: tab ? 0 : 2, li: 0, mi: 0, dir: 1, menu: false, game: null, ai: 0, gs: 0 }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('click'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const [dst, setDst] = useState(initialDiscover);
  const focusSearch = () => { setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, game: null, menu: false, dir: x.tab > 2 ? -1 : 1, tab: 2, zone: 'tiles', fi: 0 })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ tab: 1, zone: 'tiles', fi: i }); openGame(lib[i]!); }
  }, [game0, lib.length]);
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const found = useMemo(() => query.trim() ? [...data.catalog, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : data.catalog, [data.catalog, data.lib, query]);
  const tk = TABS[st.tab]![0];

  const achTot = lib.reduce((a, g) => a + (g.installed?.achievements?.total ?? 0), 0);
  const achGot = lib.reduce((a, g) => a + (g.installed?.achievements?.unlocked ?? 0), 0);
  // Jogos: os jogados recentemente ficam numa página só deles; a coleção começa na página seguinte.
  // `slot` é a posição na grade paginada; `fi` continua sendo o índice do jogo.
  const split = tk === 'games' ? data.recent : 0;
  const slotOf = (fi: number) => (split && fi >= split ? fi - split + PER : fi);
  const itemOf = (slot: number) => (split ? (slot < PER ? Math.min(slot, split - 1) : split + slot - PER) : slot);
  const slot = slotOf(st.fi);
  const tiles = ((): Tile[] | null => {
    if (tk === 'home') {
      const [g0, g1] = lib, F = data.feed;
      return [
        g1 ? { x: 0, y: 0, w: 300, h: 230, g: g1, cap: g1.title, sub: g1.installed?.playMs ? fmtPlay(g1.installed.playMs) : tt('ainda não jogado') }
          : { x: 0, y: 0, w: 300, h: 230, cls: 'grey', cap: tt('descobrir recomps'), sub: plural(data.catalog.length, tt('jogo'), tt('jogos')), go: 'cat' },
        { x: 0, y: 240, w: 300, h: 230, cls: 'acc', quick: lib.slice(0, 3), cap: tt('meus jogos'), sub: plural(lib.length, tt('instalado'), tt('instalados')), go: 'games' },
        g0 ? { x: 310, y: 0, w: 630, h: 470, g: g0, big: true, cap: g0.title, sub: g0.installed?.missing ? (g0.installed?.uninstalled ? tt('não instalado') : tt('pasta do jogo não encontrada')) : g0.installed?.playMs ? tt('{0} jogadas · continuar de onde parou', { 0: fmtPlay(g0.installed.playMs) }) : tt('ainda não jogado') }
          : { x: 310, y: 0, w: 630, h: 470, cls: 'grey', big: true, cap: data.catalog.length ? tt('nada instalado ainda') : tt('nenhum recomp ainda'), sub: data.catalog.length ? tt('abra descobrir para instalar') : tt('o radar avisa quando aparecer'), go: 'cat' },
        { x: 950, y: 0, w: 300, h: 230, cls: 'grey', txt: <><b>{F.length}</b>{F[0] ? `${F[0].title} · ${FEED[F[0].kind]}` : tt('nada novo por aqui')}</>, cap: tt('novidades'), go: 'news' },
        { x: 950, y: 240, w: 300, h: 230, cls: 'dark', txt: <><b>{achGot}/{achTot}</b>{tt('conquistas neste console')}</>, bar: achTot ? achGot / achTot : 0, cap: tt('conquistas'), go: 'ach' },
      ];
    }
    if (tk === 'games' || tk === 'cat') {
      const L = tk === 'games' ? lib : found, pg = Math.floor(slot / PER), from = itemOf(pg * PER);
      return L.slice(from, split && !pg ? split : from + PER).map((g, j) => ({
        x: (j % 5) * 254, y: Math.floor(j / 5) * 240, w: 244, h: 230, g, idx: from + j, cap: g.title,
        sub: tk === 'cat' ? `${g.status ? STATUS_LABEL[g.status].toLowerCase() : ''}${g.installed ? ' · instalado' : ''}` : g.installed?.missing ? (g.installed?.uninstalled ? tt('não instalado') : tt('pasta não encontrada')) : g.installed?.playMs ? fmtPlay(g.installed.playMs) : tt('ainda não jogado'),
        tag: g.update?.updateAvailable && !self ? tt('versão nova') : g.isNew ? tt('novo') : undefined, tagCls: g.isNew ? 'new' : '',
        cls: tk === 'cat' && !g.installed ? 'off' : g.installed?.missing ? 'off' : '',
      }));
    }
    if (tk === 'news') {
      const pg = Math.floor(st.fi / 6);
      return data.feed.slice(pg * 6, pg * 6 + 6).map((f, j) => {
        const g = data.catalog.find(y => y.catalog?.id === f.gameId);
        return { x: (j % 3) * 420, y: Math.floor(j / 3) * 240, w: 410, h: 230, g, feed: f, idx: pg * 6 + j, cap: f.title, sub: `${f.detail && !(self && f.kind === 'new') ? f.detail + ' · ' : ''}${ago(f.at)}`, tag: FEED[f.kind], tagCls: f.kind === 'new' ? 'new' : '' };
      });
    }
    return null;
  })();
  const total = tk === 'games' ? (split ? PER + lib.length - split : lib.length) : tk === 'cat' ? found.length : tk === 'news' ? data.feed.length : tiles?.length ?? 0;
  const per = tk === 'news' ? 6 : PER;
  const paged = tk === 'games' || tk === 'cat' || tk === 'news';
  const loc = paged ? slot % per : st.fi;
  const secLabel = split ? (slot < PER ? tt('jogados recentemente') : tt('coleção')) : '';
  const cur = tiles ? tiles[loc] ?? null : null;
  const feed = useFeed(data.feed, tk === 'news' && !st.game);

  const rows: Row[] = tk === 'ach' ? lib.map(g => ({ key: g.key, g, l: g.title, v: g.installed?.achievements?.total ? `${g.installed.achievements.unlocked}/${g.installed.achievements.total}` : '—' }))
    : tk === 'time' ? [{ key: 'sum', l: tt('Resumo'), ic: 'chart', v: fmtPlay(data.playMs) || '0m' }, ...byPlay.map(g => ({ key: g.key, g, l: g.title, v: fmtPlay(g.installed?.playMs ?? 0) || '0m' }))]
    : tk === 'cfg' ? CFG.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? 'ligados' : 'desligados') : '' }))
    : [];
  const row = rows[st.li];
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: row?.g?.installed?.id ?? '' }, { enabled: tk === 'ach' && !!row?.g?.installed?.adapter }));
  const statQ = useQueries({ queries: (tk === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(byPlay.map((x, i) => [x.key, statQ[i]?.data] as const));

  const game = st.game ? all.get(st.game) ?? null : null;

  const options = (x: HubGame): Opt[] => {
    const inst = x.installed;
    const L: Opt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: tt('Instalar de novo'), ic: 'dl' });
      L.push({ k: 'relink', l: inst.uninstalled ? tt('Já instalei de novo: mostrar a pasta') : tt('Procurar a pasta'), ic: 'folder' });
      if (inst.adapter) L.push({ k: 'ach', l: tt('Conquistas'), ic: 'medal' });
      L.push({ k: 'remove', l: tt('Remover da biblioteca'), ic: 'stop' });
    } else if (inst) {
      L.push(inst.running ? { k: 'play', l: tt('Voltar para o jogo'), ic: 'play' } : inst.exe ? { k: 'play', l: tt('Jogar'), ic: 'play' } : { k: 'exe', l: tt('Escolher o .exe'), ic: 'folder' });
      if (inst.running) L.push({ k: 'quit', l: tt('Fechar o jogo'), ic: 'stop' });
      if (x.update?.updateAvailable && !self) L.push({ k: 'update', l: tt('Atualizar para {0}', { 0: x.update.latest?.tag }), ic: 'dl' });
      if (inst.adapter) L.push({ k: 'ach', l: tt('Conquistas'), ic: 'medal' });
      L.push({ k: 'time', l: tt('Tempo de jogo'), ic: 'clock' });
      L.push({ k: 'folder', l: tt('Abrir pasta'), ic: 'folder' });
      if (inst.exe) L.push({ k: 'exe', l: tt('Escolher o .exe'), ic: 'folder' });
      if (!inst.running) L.push({ k: 'uninstall', l: tt('Desinstalar'), ic: 'trash' }, { k: 'remove', l: tt('Remover da biblioteca'), ic: 'stop' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: tt('Instalar'), ic: 'dl' });
      L.push({ k: 'add', l: self ? tt('Já instalei: adicionar pasta') : tt('Escolher pasta'), ic: 'folder' });
    }
    if (x.repo) L.push({ k: 'gh', l: tt('Ver no GitHub'), ic: 'link' });
    if (!st.game) L.push({ k: 'info', l: tt('Página do jogo'), ic: 'info' });
    return L;
  };
  const primaryOf = (x: HubGame) => options(x)[0]!;
  const gameOpts = game ? options(game) : [];
  const goTab = (i: number, extra: Partial<St> = {}) => {
    const n = (i + TABS.length) % TABS.length;
    const k = TABS[n]![0];
    set(x => ({ ...x, tab: n, dir: n > x.tab ? 1 : -1, fi: k === 'home' ? 2 : 0, li: 0, menu: false, zone: x.zone === 'tabs' && !extra.zone ? 'tabs' : k === 'ach' || k === 'time' || k === 'cfg' ? 'list' : 'tiles', ...extra }));
  };
  const openGame = (x: HubGame) => { up({ game: x.key, menu: false, zone: 'gacts', ai: 0, gs: 0 }); };
  const openPage = (x: HubGame) => { sfx.play('ok'); up({ menu: false }); openGame(x); };

  const run = (k: string, x: HubGame) => {
    up({ menu: false });
    if (k === 'quit') { act.quit(x); sfx.play('back'); show(tt('Fechando {0}…', { 0: x.title })); return; }
    if (k === 'play' || k === 'install') {
      const r = act.primary(x);
      sfx.play('ok');
      if (r === 'play') show(tt('{0} aberto · o tempo de jogo começou a contar', { 0: x.title }));
      else if (r === 'install') show(tt('Baixando {0} do GitHub…', { 0: x.repo }));
      else if (r === 'pick') chooseExe.mutate({ id: x.installed!.id });
      else if (r === 'relink') show(tt('Escolha onde o jogo está agora'));
      return;
    }
    sfx.play('ok');
    if (k === 'add') { act.addFolder(x); return show(tt('Escolha a pasta onde o jogo está instalado')); }
    if (k === 'reinstall') { act.reinstall(x); return show(tt('Baixando {0} de novo… o tempo de jogo continua', { 0: x.repo })); }
    if (k === 'relink') { act.relink(x); return show(tt('Escolha onde o jogo está agora')); }
    if (k === 'uninstall') { void act.uninstall(x).then(r => { if (!r) return; up({ game: null }); show(uninstallMsg(r, x.title)); }); return; }
    if (k === 'remove') { void act.remove(x).then(ok => { if (!ok) return; up({ game: null }); show(tt('{0} saiu da biblioteca', { 0: x.title })); }); return; }
    if (k === 'update') { act.update(x); return show(tt('Atualizando para {0}… configurações e saves ficam', { 0: x.update?.latest?.tag })); }
    if (k === 'ach') { up({ game: null }); return goTab(4, { zone: 'list', li: Math.max(0, lib.indexOf(x)) }); }
    if (k === 'time') { up({ game: null }); return goTab(5, { zone: 'list', li: Math.max(0, byPlay.indexOf(x) + 1) }); }
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
  };

  const enter = () => {
    if (st.menu && cur?.g) { const o = options(cur.g)[st.mi]; if (o) run(o.k, cur.g); return; }
    if (st.zone === 'tabs') { sfx.play('ok'); return up({ zone: tiles ? 'tiles' : 'list' }); }
    if (tiles) {
      if (!cur) return;
      if (cur.go) { sfx.play('ok'); return goTab(TABS.findIndex(t => t[0] === cur.go), { zone: cur.go === 'ach' ? 'list' : 'tiles' }); }
      if (cur.feed) { feed.done(cur.feed); if (cur.g) { sfx.play('ok'); openGame(cur.g); } return; }
      if (cur.g) { if (semArquivos(cur.g)) return openPage(cur.g); if (tk === 'cat') { sfx.play('ok'); return openGame(cur.g); } return run(primaryOf(cur.g).k, cur.g); }
      return;
    }
    if (tk === 'cfg' && row) {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show(tt('O radar confere o catálogo do Recompendium toda vez que o Cosmo abre'));
    }
    if (tk === 'time' && row?.g) { sfx.play('ok'); return openGame(row.g); }
    if (tk === 'ach' && row?.g) { sfx.play('ok'); return openGame(row.g); }
  };
  const back = () => {
    sfx.play('back');
    if (game) return up({ game: null });
    if (st.menu) return up({ menu: false });
    if (tk === 'cat' && query) return setQuery('');
    if (st.tab !== 0) return set(x => ({ ...x, tab: 0, fi: 2, zone: 'tiles', dir: -1 }));
    onBack();
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (st.menu && cur?.g) {
      const n = options(cur.g).length;
      if (D && st.mi < n - 1) mv({ mi: st.mi + 1 }); else if (U && st.mi > 0) mv({ mi: st.mi - 1 });
      return;
    }
    if (k === 'LB' || k === 'RB' || k === 'Tab') { sfx.play('move'); return goTab(st.tab + (k === 'LB' ? -1 : 1)); }
    if (tk === 'news' && st.zone !== 'tabs' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && feed.drop(cur?.feed)) up({ fi: Math.max(0, Math.min(st.fi, data.feed.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (k === 'Y') { sfx.play('ok'); if (tk !== 'cat') goTab(2, { zone: 'tiles' }); focusSearch(); return; }
    if (k === 'X') { if (cur?.g) { sfx.play('ok'); up({ menu: true, mi: 0 }); } return; }
    if (st.zone === 'tabs') {
      if (L) { sfx.play('move'); goTab(st.tab - 1); } else if (R) { sfx.play('move'); goTab(st.tab + 1); }
      else if (D) mv({ zone: tiles ? 'tiles' : 'list' });
      return;
    }
    if (st.zone === 'list') {
      if (D && st.li < rows.length - 1) mv({ li: st.li + 1 });
      else if (U) { if (st.li > 0) mv({ li: st.li - 1 }); else mv({ zone: 'tabs' }); }
      else if (L) { sfx.play('move'); goTab(st.tab - 1, { zone: 'list' }); } else if (R) { sfx.play('move'); goTab(st.tab + 1, { zone: 'list' }); }
      return;
    }
    if (!tiles || !tiles.length) {
      if (U) mv({ zone: 'tabs' }); else if (L) { sfx.play('move'); goTab(st.tab - 1, { zone: 'tiles' }); } else if (R) { sfx.play('move'); goTab(st.tab + 1, { zone: 'tiles' }); }
      else if (D && tk === 'cat') focusSearch();
      return;
    }
    const base = paged ? Math.floor(slot / per) * per : 0;
    const nx = nearest(tiles, loc, k);
    if (nx >= 0) return mv({ fi: itemOf(base + nx) });
    if (paged && R && total > base + per) return mv({ fi: itemOf(base + per) });
    if (paged && L && base > 0) return mv({ fi: itemOf(base - per + (per === PER ? 4 : 2)) });
    if (D && tk === 'cat') { sfx.play('ok'); return focusSearch(); }
    if (U) return mv({ zone: 'tabs' });
    if (R) { sfx.play('move'); return goTab(st.tab + 1, { zone: 'tiles' }); }
    if (L) { sfx.play('move'); return goTab(st.tab - 1, { zone: 'tiles' }); }
  }, !((tk === 'cat' && !game && !st.menu) || game));

  const hints: Hint[] = st.menu ? [['ok', tt('Selecionar')], ['back', tt('Fechar')]]
    : !tiles ? [['ok', tt('Selecionar')], ['back', tt('Voltar')], ['rb', tt('Abas')]]
    : tk === 'news' && cur?.feed ? [['ok', tt('Ver jogo')], ['x', tt('Dispensar')], ['y', tt('Limpar tudo')], ['back', tt('Voltar')]]
    : cur?.g ? [['ok', semArquivos(cur.g) ? tt('Página do jogo') : tk === 'cat' || cur.feed ? tt('Ver jogo') : primaryOf(cur.g).l], ['x', tt('Opções')], ['y', tt('Buscar')], ['back', st.tab ? tt('Voltar') : tt('Sair')]]
    : [['ok', tt('Selecionar')], ['y', tt('Buscar')], ['back', st.tab ? tt('Voltar') : tt('Sair')]];
  const tabsRef = useRef<HTMLElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => { const el = tabsRef.current?.children[st.tab] as HTMLElement | undefined; if (el) setShift(el.offsetLeft); }, [st.tab, !!game, data.feed.length]);
  const artG = game ?? cur?.g ?? row?.g ?? null;
  const pages = paged ? Math.max(1, Math.ceil(total / per)) : 0;

  return (
    <section className="view hub sk-x3" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`x3 ${og ? 'og' : ''}`} style={{ ['--cc' as string]: c.color }}>
        <Backdrop g={artG} />
        <div className="x3-floor" />
        {game ? (
          <GameView theme={`d-x3 ${og ? 'og' : ''}`} g={game} self={self} run={run} onBack={() => up({ game: null })}
            opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />
        ) : tk === 'cat' ? (
          <Discover theme={`d-x3 ${og ? 'og' : ''}`} cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info').map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
            run={run} onOpen={openGame} onBack={() => { sfx.play('back'); set(x => ({ ...x, tab: 0, fi: 2, zone: 'tiles', dir: -1 })); }} />
        ) : (
          <>
            <div className="x3-me"><span>{tt('Cosmo')}<small>{fmtPlay(data.playMs) || '0m'} · {clock}</small></span><i><Ic n="pad" /></i></div>
            <nav className="x3-tabs" ref={tabsRef} style={{ transform: `translateX(-${shift}px)` }}>{TABS.map(([k, l], j) => (
              <button key={k} className={j === st.tab ? `on ${st.zone === 'tabs' ? 'f' : ''}` : ''} onClick={() => { sfx.play('move'); goTab(j, { zone: k === 'ach' || k === 'time' || k === 'cfg' ? 'list' : 'tiles' }); }}>
                {l}{k === 'news' && data.feed.length > 0 && <span className="n">{data.feed.length}</span>}
              </button>
            ))}</nav>
            {tiles ? (
              <>
                <div className={`x3-pg ${st.dir < 0 ? 'back' : ''}`} key={`${tk}-${Math.floor(slot / per)}`} onWheel={wheelNav('h')}>
                  {tiles.length ? tiles.map((t, j) => (
                    <button key={`${t.cap}-${j}`} className={`xt ${t.cls ?? ''} ${st.zone === 'tiles' && j === loc ? 'on' : ''}`} style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                      onClick={e => {
                        const x = t.g;
                        if (x && !t.go && !t.feed) return tileClick(e, x, { select: () => { if (st.zone !== 'tiles' || j !== loc) mv2(j); }, page: () => { sfx.play('ok'); openGame(x); }, play: () => run('play', x) });
                        if (st.zone === 'tiles' && j === loc) enter(); else mv2(j);
                      }}>
                      {t.g && <Art g={t.g} v={t.big || t.w > 300 ? 'wide' : 'square'} />}
                      {t.quick && <div className="mini">{t.quick.map(q => <span key={q.key}><Art g={q} v="square" /></span>)}</div>}
                      {t.txt && <div className="txt">{t.txt}</div>}
                      {t.bar != null && <div className="bar"><i style={{ width: `${t.bar * 100}%` }} /></div>}
                      {t.g?.installed?.running && <span className="run"><Ic n="play" /></span>}
                      {t.tag && <span className={`tg ${t.tagCls ?? ''}`}>{t.tag}</span>}
                      <div className={`cap ${t.big ? 'big' : ''}`}>{t.cap}{t.sub && <small>{t.sub}</small>}</div>
                    </button>
                  )) : (
                    <div className="xt grey empty" style={{ left: 0, top: 0, width: 630, height: 230 }}>
                      <div className="cap">{tk === 'games' ? tt('nenhum jogo instalado') : tt('nada por aqui ainda')}</div>
                    </div>
                  )}
                </div>
                <div className="x3-peek"><div>{TABS[(st.tab + 1) % TABS.length]![1]}</div><div /><div /></div>
                {(pages > 1 || secLabel) && <div className="x3-pages">{secLabel && <b>{secLabel}</b>}{pages > 1 && `${Math.floor(slot / per) + 1} / ${pages}`}</div>}
              </>
            ) : (
              <div className={`x3-lw ${st.dir < 0 ? 'back' : ''}`} key={tk}>
                <div className="x3-lst">
                  <div style={{ transform: `translateY(-${Math.max(0, st.li - (LIST_ROWS - 2)) * 74}px)` }}>
                    {rows.length ? rows.map((r, j) => (
                      <button key={r.key} className={st.zone === 'list' && j === st.li ? 'on' : ''} onClick={() => { if (st.zone === 'list' && st.li === j) enter(); else { sfx.play('move'); up({ zone: 'list', li: j }); } }}>
                        {r.g ? <span className="th"><Art g={r.g} v="square" /></span> : r.ic ? <Ic n={r.ic} /> : null}
                        <span className="l">{r.l}</span><span className="v">{r.v}</span>
                      </button>
                    )) : <div className="x3-none">{tt('nenhum jogo instalado neste console')}</div>}
                  </div>
                </div>
                <div className="x3-det">
                  <Detail tk={tk} row={row} achList={ach.data?.list ?? []} achLoading={ach.isLoading} stats={row?.g ? stats.get(row.g.key) : undefined}
                    lib={byPlay} statsAll={stats} playMs={data.playMs} cname={c.name} sndOn={s.snd} />
                </div>
              </div>
            )}
            <div className={`x3-dots ${tiles ? '' : 'low'}`}>{TABS.map((_, j) => <i key={j} className={j === st.tab ? 'on' : ''} />)}</div>
          </>
        )}
        {st.menu && cur?.g && !game && (
          <div className="x3-menu" onClick={() => up({ menu: false })}>
            <div className="w" onClick={e => e.stopPropagation()}>
              <div className="x3-lst">{options(cur.g).map((o, j) => (
                <button key={o.k + j} className={j === st.mi ? 'on' : ''} onClick={() => { if (st.mi === j) enter(); else { sfx.play('move'); up({ mi: j }); } }}><Ic n={o.ic} /><span className="l">{o.l}</span></button>
              ))}</div>
              <div className="x3-det"><MenuInfo g={cur.g} self={self} /></div>
            </div>
          </div>
        )}
        {tk !== 'cat' && !game && <div className="x3-ft">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>}
        {toast}
      </Fit>
      <BootOverlay kind={og ? 'soft' : 'sweep'} label={c.name.toUpperCase()} />
    </section>
  );

  function mv2(j: number) { sfx.play('move'); up({ zone: 'tiles', fi: paged ? itemOf(Math.floor(slot / per) * per + j) : j }); }
}

function Backdrop({ g }: { g: HubGame | null }) {
  const art = useArt(g?.console, g?.title ?? '', g?.platformName);
  const src = g ? art.fanart ?? art.cover ?? g.coverUrl : null;
  return <div className="x3-bg">{src ? <img key={src} src={src} alt="" /> : <div className="glow" />}</div>;
}

function MenuInfo({ g, self }: { g: HubGame; self: boolean }) {
  const needs = useTranslated(g.catalog?.needs);
  const i = g.installed;
  return (
    <>
      <h3>{g.title}</h3>
      <div className="r"><span>{tt('status')}</span><span>{g.status ? STATUS_LABEL[g.status] : '—'}</span></div>
      {g.catalog?.developer && <div className="r"><span>{tt('estúdio')}</span><span>{g.catalog.developer}</span></div>}
      <div className="r"><span>{tt('tempo')}</span><span>{i ? fmtPlay(i.playMs) || '0m' : tt('não instalado')}</span></div>
      {!i && needs.text && <p className="sm">{tt('Precisa: {0}', { 0: needs.text })}</p>}
      {self && !i && <p className="sm">{SELF_INSTALL_NOTE}</p>}
    </>
  );
}

function Detail({ tk, row, achList, achLoading, stats, lib, statsAll, playMs, cname, sndOn }: {
  tk: Tab; row: Row | undefined; achList: { id: number; name: string; unlockedAt: number | null; points: number | null }[]; achLoading: boolean;
  stats: PlayStats | undefined; lib: HubGame[]; statsAll: Map<string, PlayStats | undefined>; playMs: number; cname: string; sndOn: boolean;
}) {
  if (!row) return <><h3>{tt('nada por aqui')}</h3><p className="sm">{tt('Sem itens nesta lista ainda.')}</p></>;
  if (tk === 'ach' && row.g) {
    const a = row.g.installed?.achievements;
    if (!row.g.installed?.adapter) return <><h3>{row.g.title}</h3><p className="sm">{tt('O Cosmo ainda não sabe ler as conquistas deste port. Quando houver um leitor, elas aparecem aqui sozinhas.')}</p></>;
    const L = [...achList].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{a?.unlocked ?? 0}/{a?.total ?? L.length}</div>
        {achLoading && !L.length ? <p className="sm">{tt('lendo…')}</p> : L.slice(0, 6).map(x => (
          <div key={x.id} className={`r ${x.unlockedAt != null ? '' : 'lock'}`}><span><Ic n={x.unlockedAt != null ? 'medal' : 'lock'} /> {x.name}</span><span>{x.unlockedAt != null ? fmtDate(x.unlockedAt) : 'bloqueada'}</span></div>
        ))}
        {L.length > 6 && <p className="sm">{tt('e mais {0}… Enter abre a página do jogo', { 0: L.length - 6 })}</p>}
      </>
    );
  }
  if (tk === 'time') {
    if (!row.g) {
      const ses = lib.reduce((a, g) => a + (statsAll.get(g.key)?.sessions ?? 0), 0);
      const week = lib.reduce((a, g) => a + (statsAll.get(g.key)?.days.slice(7).reduce((p, q) => p + q, 0) ?? 0), 0) * 3600_000;
      return <><h3>{tt('neste console')}</h3><div className="big">{fmtPlay(playMs) || '0m'}</div><p className="sm">{tt('{0} em {1}', { 0: plural(ses, tt('sessão'), tt('sessões')), 1: plural(lib.length, tt('jogo'), tt('jogos')) })}<br />{tt('{0} nesta semana', { 0: fmtPlay(week) || '0m' })}</p></>;
    }
    const i = row.g.installed!, d = stats?.days ?? Array(14).fill(0), m = Math.max(...d, 0.01);
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{fmtPlay(i.playMs) || '0m'}</div>
        <p className="sm">{plural(stats?.sessions ?? 0, tt('sessão'), tt('sessões'))}{stats?.avgMs ? tt(' · média {0}', { 0: fmtPlay(stats.avgMs) || '<1m' }) : ''}{i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : ''}</p>
        <div className="bars">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(3, (v / m) * 100) : 2}%` }} />)}</div>
        <p className="sm">{tt('últimos 14 dias')}</p>
      </>
    );
  }
  if (tk === 'cfg') {
    if (row.id === 'dir') return <><h3>{row.l}</h3><p className="sm">{tt('Onde o Cosmo instala o que você baixa. Jogos adicionados com “Escolher pasta” continuam onde estão.')}</p><div className="path"><PortsDir /></div></>;
    if (row.id === 'snd') return <><h3>{row.l}</h3><p className="sm">{tt('Sons de navegação da interface: {0}. Enter alterna.', { 0: sndOn ? tt('ligados') : tt('desligados') })}</p></>;
    if (row.id === 'radar') return <><h3>{row.l}</h3><p className="sm">{tt('O radar confere o catálogo do Recompendium e os releases do GitHub toda vez que o Cosmo abre, e avisa quando algo muda em {0}.', { 0: cname })}</p></>;
    return <><h3>{row.l}</h3><p className="sm">{tt('Desliga este console e volta para o palco do Cosmo.')}</p></>;
  }
  return null;
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
