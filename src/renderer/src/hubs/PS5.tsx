import { useProfile } from '../lib/profile';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { semArquivos, tileClick } from '@shared/gameclick';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId } from '@shared/types';
import { isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { useArt } from '../lib/art';
import { GameArt } from '../components/GameArt';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useFeed, useGameProgress, useHubActions, useHubData, type HubGame, uninstallMsg } from './data';
import { wheelNav } from './wheel';
import { tt } from '@shared/i18n';

type Page = 'home' | 'cat' | 'ach' | 'news' | 'cfg' | 'game';
type Zone = 'top' | 'row' | 'acts' | 'cards' | 'tabs' | 'shelf' | 'side' | 'main' | 'gacts' | 'gshots' | 'gtext';
interface St { page: Page; zone: Zone; di: number; idx: number; ai: number; ci: number; ti: number; si: number; gi: number; game: string | null; from: { page: Page; zone: Zone; si: number } | null }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const TOP: [string, string | IconName][] = [['games', tt('Jogos')], ['cat', tt('Descobrir')], ['search', 'search'], ['news', 'bell'], ['cfg', 'gear'], ['ach', 'medal']];
const TAGS = { new: tt('Novo no catálogo'), upd: tt('Versão nova'), up: tt('Mudou de status') } as const;
const SHORT = { new: tt('Novo'), upd: tt('Versão nova'), up: tt('Status') } as const;
const CFG: Opt[] = [{ k: 'dir', l: tt('Pasta dos jogos'), ic: 'folder' }, { k: 'snd', l: tt('Sons da interface'), ic: 'sound' }, { k: 'radar', l: tt('Radar de novidades'), ic: 'bell' }, { k: 'off', l: tt('Voltar ao Cosmo'), ic: 'power' }];

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} done={!!g.installed?.achievements?.complete} />;

export function PS5Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ page: tab === 'cat' ? 'cat' : 'home', zone: tab === 'cat' ? 'shelf' : 'row', di: 0, idx: 0, ai: 0, ci: 0, ti: 0, si: 0, gi: 0, game: null, from: null }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [menu, setMenu] = useState<{ g: HubGame; mi: number } | null>(null);
  const [dst, setDst] = useState(initialDiscover);
  const toSearch = () => { setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusSearch, 80); };
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('soft'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  useEffect(() => {
    const go = () => { sfx.play('ok'); setMenu(null); set(x => ({ ...x, page: 'cat' })); toSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const row = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = row.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ idx: i }); openGame(row[i]!); }
  }, [game0, row.length]);
  const g = st.page === 'home' ? row[st.idx] ?? null : null;
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const game = st.page === 'game' && st.game ? all.get(st.game) ?? null : null;
  useEffect(() => { if (st.page === 'game' && st.game && all.size && !all.has(st.game)) up({ page: 'home', zone: 'row', game: null, from: null }); }, [st.page, st.game, all]);

  const achGames = data.lib;
  const achGame = achGames[st.gi] ?? null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: st.page === 'ach' && !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];

  const options = (x: HubGame, home: boolean): Opt[] => {
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
      L.push({ k: 'folder', l: tt('Abrir pasta'), ic: 'folder' });
      if (inst.exe) L.push({ k: 'exe', l: tt('Escolher o .exe'), ic: 'folder' });
      if (!inst.running) L.push({ k: 'uninstall', l: tt('Desinstalar'), ic: 'trash' }, { k: 'remove', l: tt('Remover da biblioteca'), ic: 'stop' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: tt('Instalar'), ic: 'dl' });
      L.push({ k: 'add', l: self ? tt('Já instalei: adicionar pasta') : tt('Escolher pasta'), ic: 'folder' });
    }
    if (x.repo) L.push({ k: 'gh', l: tt('Ver no GitHub'), ic: 'link' });
    if (st.page !== 'game') L.push({ k: 'info', l: tt('Página do jogo'), ic: 'info' });
    if (home) L.push({ k: 'off', l: tt('Voltar ao Cosmo'), ic: 'power' });
    return L;
  };
  const run = (k: string, x: HubGame) => {
    setMenu(null);
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
    if (k === 'uninstall') { void act.uninstall(x).then(r => { if (!r) return; if (st.page === 'game') up({ page: st.from?.page ?? 'home', zone: st.from?.zone ?? 'row', game: null, from: null }); show(uninstallMsg(r, x.title)); }); return; }
    if (k === 'remove') { void act.remove(x).then(ok => { if (!ok) return; if (st.page === 'game') up({ page: st.from?.page ?? 'home', zone: st.from?.zone ?? 'row', game: null, from: null }); show(tt('{0} saiu da biblioteca', { 0: x.title })); }); return; }
    if (k === 'update') { act.update(x); return show(tt('Atualizando para {0}… configurações e saves ficam', { 0: x.update?.latest?.tag })); }
    if (k === 'ach') { up({ page: 'ach', zone: 'side', gi: Math.max(0, achGames.indexOf(x)), si: 0 }); return; }
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
    if (k === 'off') return onBack();
  };
  const primaryOf = (x: HubGame) => options(x, false)[0]!;
  const openPage = (x: HubGame) => { sfx.play('ok'); setMenu(null); openGame(x); };
  const openGame = (x: HubGame) => { setMenu(null); up({ page: 'game', game: x.key, from: { page: st.page, zone: st.zone, si: st.si }, zone: 'gacts', ai: 0, si: 0 }); };
  const gameOpts = game ? options(game, false) : [];

  const open = (page: Page, extra: Partial<St> = {}) => { sfx.play('ok'); setMenu(null); up({ page, zone: page === 'cat' ? 'tabs' : page === 'ach' ? 'side' : 'main', si: 0, ti: 0, ...extra }); };
  const top = (j: number) => {
    const k = TOP[j]![0];
    if (k === 'games') { sfx.play('move'); return up({ zone: 'row' }); }
    if (k === 'search') { open('cat'); toSearch(); return; }
    open(k as Page, k === 'ach' ? { gi: 0 } : {});
  };
  const feed = useFeed(data.feed, st.page === 'news');
  const enter = () => {
    if (menu) { const o = options(menu.g, st.page === 'home')[menu.mi]; if (o) run(o.k, menu.g); return; }
    const p = st.page, z = st.zone;
    if (p === 'home') {
      if (z === 'top') return top(st.di);
      if (!g) return open('cat', { zone: 'shelf' });
      if (z === 'acts' && st.ai === 1) { sfx.play('ok'); return setMenu({ g, mi: 0 }); }
      if (z === 'cards') {
        if (st.ci === 0 && g.installed?.adapter) return run('ach', g);
        if (st.ci === 2) return open('news');
        if (st.ci === 3 && g.update?.updateAvailable && !self) return run('update', g);
        return sfx.play('move');
      }
      if (semArquivos(g)) return openPage(g);
      return run(primaryOf(g).k, g);
    }
    if (p === 'ach') { if (z === 'side' && achList.length) { sfx.play('move'); up({ zone: 'main', si: 0 }); } return; }
    if (p === 'cfg') {
      const k = CFG[st.si]!.k; sfx.play('ok');
      if (k === 'dir') return pickDir.mutate();
      if (k === 'snd') return setSettings({ snd: !getSettings().snd });
      if (k === 'off') return onBack();
      return show(tt('O radar confere o catálogo do Recompendium toda vez que o Cosmo abre'));
    }
    if (p === 'news') { const f = data.feed[st.si]; feed.done(f); const x = f && data.catalog.find(y => y.catalog?.id === f.gameId); if (x) { sfx.play('ok'); setMenu({ g: x, mi: 0 }); } }
  };
  const closeGame = () => { const f = st.from; up({ page: f?.page ?? 'home', zone: f?.zone ?? 'row', si: f?.si ?? 0, game: null, from: null }); };
  const back = () => {
    if (menu) { sfx.play('back'); return setMenu(null); }
    if (st.page === 'game') { sfx.play('back'); return closeGame(); }
    const p = st.page, z = st.zone;
    if (p === 'home') { if (z !== 'row') { sfx.play('back'); return up({ zone: 'row' }); } sfx.play('back'); return onBack(); }
    sfx.play('back');
    if (p === 'ach' && z === 'main') return up({ zone: 'side' });
    up({ page: 'home', zone: 'row' });
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (menu) {
      const n = options(menu.g, st.page === 'home').length;
      if (D && menu.mi < n - 1) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi + 1 }); }
      else if (U && menu.mi > 0) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi - 1 }); }
      return;
    }
    if (st.page === 'news' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && feed.drop(data.feed[st.si])) up({ si: Math.max(0, Math.min(st.si, data.feed.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (k === 'X' || k === 'Y') {
      if (st.page === 'home' && g) { sfx.play('ok'); setMenu({ g, mi: 0 }); }
      return;
    }
    const p = st.page, z = st.zone, n = row.length + 1;
    if (p === 'home') {
      if (z === 'top') { if (R && st.di < TOP.length - 1) mv({ di: st.di + 1 }); else if (L && st.di > 0) mv({ di: st.di - 1 }); else if (D) mv({ zone: 'row' }); return; }
      if (z === 'row') { if (R && st.idx < n - 1) mv({ idx: st.idx + 1 }); else if (L && st.idx > 0) mv({ idx: st.idx - 1 }); else if (U) mv({ zone: 'top', di: 0 }); else if (D) mv({ zone: 'acts', ai: 0 }); return; }
      if (z === 'acts') { if (R && g) mv({ ai: 1 }); else if (L) mv({ ai: 0 }); else if (U) mv({ zone: 'row' }); else if (D && g) mv({ zone: 'cards', ci: 0 }); return; }
      if (z === 'cards') { if (R && st.ci < 3) mv({ ci: st.ci + 1 }); else if (L && st.ci > 0) mv({ ci: st.ci - 1 }); else if (U) mv({ zone: 'acts' }); return; }
    }
    if (p === 'ach') {
      if (z === 'side') { if (D && st.gi < achGames.length - 1) mv({ gi: st.gi + 1, si: 0 }); else if (U && st.gi > 0) mv({ gi: st.gi - 1, si: 0 }); else if (R && achList.length) mv({ zone: 'main', si: 0 }); return; }
      if (D && st.si < achList.length - 1) mv({ si: st.si + 1 }); else if (U && st.si > 0) mv({ si: st.si - 1 }); else if (L) mv({ zone: 'side' });
      return;
    }
    const total = p === 'cfg' ? CFG.length : data.feed.length;
    if (D && st.si < total - 1) mv({ si: st.si + 1 }); else if (U && st.si > 0) mv({ si: st.si - 1 });
  }, !(st.page === 'cat' || st.page === 'game'));

  const hints: Hint[] = menu ? [['ok', tt('Confirmar')], ['back', tt('Fechar')]]
    : st.page === 'home' && st.zone === 'row' && g ? [['ok', !semArquivos(g) ? primaryOf(g).l : tt('Página do jogo')], ['x', tt('Opções')]]
    : st.page === 'news' && data.feed.length ? [['ok', tt('Abrir')], ['x', tt('Dispensar')], ['y', tt('Limpar tudo')], ['back', tt('Voltar')]]
    : [['ok', tt('Confirmar')], ['back', tt('Voltar')]];
  const H = ({ className }: { className: string }) => <div className={className}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;

  const setMenuIdx = (mi: number) => { if (menu) { if (menu.mi === mi) { const o = options(menu.g, st.page === 'home')[mi]; if (o) run(o.k, menu.g); } else setMenu({ ...menu, mi }); } };
  const menuNode = menu && (
    <div className="p5-menu">
      <h4>{menu.g.title}</h4>
      {options(menu.g, st.page === 'home').map((o, j) => <button key={o.k + j} className={j === menu.mi ? 'on' : ''} onClick={() => setMenuIdx(j)}><Ic n={o.ic} />{o.l}</button>)}
    </div>
  );

  return (
    <section className="view hub sk-p5" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className="p5" style={{ ['--cc' as string]: c.color }}>
        {st.page === 'home' ? (
          <Home c={c.name} g={g} row={row} split={data.recent} st={st} self={self} clock={clock} feedCount={data.feed.length} catCount={data.catalog.length}
            primary={g ? primaryOf(g).l : tt('Descobrir')} feed={g ? data.feed.find(f => f.gameId === g.catalog?.id) ?? null : null}
            onTile={(i, e) => {
              const x = row[i];
              if (e && x) return tileClick(e, x, { select: () => { setMenu(null); if (st.zone !== 'row' || st.idx !== i) { sfx.play('move'); up({ zone: 'row', idx: i }); } }, page: () => openGame(x), play: () => run('play', x) });
              if (st.zone === 'row' && st.idx === i) enter(); else { sfx.play('move'); setMenu(null); up({ zone: 'row', idx: i }); }
            }}
            onTop={j => { up({ zone: 'top', di: j }); top(j); }}
            onAct={j => { if (st.zone === 'acts' && st.ai === j) enter(); else { sfx.play('move'); up({ zone: 'acts', ai: j }); } }}
            onCard={j => { if (st.zone === 'cards' && st.ci === j) enter(); else { sfx.play('move'); up({ zone: 'cards', ci: j }); } }}
            hints={<H className="p5-hint" />} menu={menuNode} />
        ) : (
          <div className={`p5-pg ${st.page === 'game' ? 'p5-gpage' : ''}`} key={st.page}>
            {st.page === 'game' && game && <GameView theme="d-p5" g={game} self={self} run={run} onBack={closeGame}
              opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />}
            {st.page === 'cat' && (
              <Discover theme="d-p5" cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
                options={x => options(x, false).filter(o => o.k !== 'info' && o.k !== 'off').map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
                run={run} onOpen={openGame} onBack={() => { setMenu(null); up({ page: 'home', zone: 'row' }); }} />
            )}
            {st.page === 'ach' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="medal" /></span>{tt('Conquistas')}</div>
                <div className="p5-gl">{achGames.map((x, j) => (
                  <button key={x.key} className={j === st.gi ? (st.zone === 'side' ? 'on' : 'sel') : ''} aria-label={x.title} onClick={() => { sfx.play('move'); up({ zone: 'side', gi: j, si: 0 }); }}><Art g={x} v="wide" /></button>
                ))}</div>
                <div className="p5-list">
                  {achGame && <div className="p5-lt">{achGame.title}</div>}
                  {!achGame ? <div className="p5-li">{tt('Nenhum jogo instalado neste console.')}</div>
                    : !achGame.installed?.adapter ? <div className="p5-li tall">{tt('O Cosmo ainda não sabe ler as conquistas de {0}.', { 0: achGame.title })}</div>
                    : !achList.length ? <div className="p5-li">{ach.isLoading ? tt('Lendo…') : tt('Nenhuma conquista encontrada.')}</div>
                    : <div style={{ transform: `translateY(-${Math.max(0, st.si - 5) * 100}px)`, transition: 'transform .25s' }}>{achList.map((a, j) => (
                        <button key={a.id} className={`p5-li ${st.zone === 'main' && j === st.si ? 'on' : ''}`} onClick={() => { sfx.play('move'); up({ zone: 'main', si: j }); }}>
                          <span className={`md ${a.unlockedAt != null ? 'got' : 'lock'}`}>{a.icon ? <img src={a.icon} alt="" /> : <Ic n={a.unlockedAt != null ? 'medal' : 'lock'} />}</span>
                          <span>{a.name}<small>{a.description}</small></span>
                          <span className="v">{a.points != null ? `${a.points} G · ` : ''}{a.unlockedAt != null ? fmtDate(a.unlockedAt) : 'bloqueada'}</span>
                        </button>
                      ))}</div>}
                </div>
                {achList.length > 0 && (() => { const got = achList.filter(a => a.unlockedAt != null).length; return <div className="p5-prog"><b>{Math.round((got / achList.length) * 100)}%</b>{tt('{0} de {1}', { 0: got, 1: achList.length })}</div>; })()}
              </>
            )}
            {st.page === 'news' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="bell" /></span>{tt('Novidades')}</div>
                <div className="p5-list wide">{data.feed.length ? data.feed.map((f, j) => {
                  const x = data.catalog.find(y => y.catalog?.id === f.gameId);
                  return (
                    <button key={f.id} className={`p5-li news ${j === st.si ? 'on' : ''}`} onClick={() => { sfx.play('move'); up({ si: j }); }}>
                      {x ? <span className="th"><Art g={x} v="square" /></span> : null}
                      <span>{f.title}<small>{f.kind === 'new' ? (x?.repo ?? '') : f.detail}</small></span>
                      <span className="v">{TAGS[f.kind]} · {ago(f.at)}</span>
                    </button>
                  );
                }) : <div className="p5-li">{tt('Nada novo por aqui. O Cosmo confere o Recompendium toda vez que abre.')}</div>}</div>
              </>
            )}
            {st.page === 'cfg' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="gear" /></span>{tt('Ajustes')}</div>
                <div className="p5-list mid">{CFG.map((o, j) => (
                  <button key={o.k} className={`p5-li ${j === st.si ? 'on' : ''}`} onClick={() => { if (st.si === j) enter(); else { sfx.play('move'); up({ si: j }); } }}>
                    <Ic n={o.ic} />{o.l}<span className="v">{o.k === 'snd' ? (s.snd ? tt('Ligados') : tt('Desligados')) : o.k === 'dir' ? <PortsDir /> : ''}</span>
                  </button>
                ))}</div>
              </>
            )}
            {st.page !== 'cat' && st.page !== 'game' && <H className="p5-ft" />}
            {menuNode}
          </div>
        )}
        {toast}
      </Fit>
      <BootOverlay kind="soft" label={c.name.toUpperCase()} />
    </section>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}

/** Espaço entre os jogados recentemente e a coleção na fileira. */
const SEC_GAP = 44;

function Home({ c, g, row, split, st, self, clock, feedCount, catCount, primary, feed, onTile, onTop, onAct, onCard, hints, menu }: {
  c: string; g: HubGame | null; row: HubGame[]; split: number; st: St; self: boolean; clock: string; feedCount: number; catCount: number; primary: string;
  feed: { kind: 'new' | 'upd' | 'up'; detail: string; at: number } | null;
  onTile: (i: number, e?: MouseEvent) => void; onTop: (j: number) => void; onAct: (j: number) => void; onCard: (j: number) => void; hints: ReactNode; menu: ReactNode;
}) {
  const me = useProfile();
  const z = st.zone, i = st.idx, n = row.length;
  const art = useArt(g?.console, g?.title ?? '', g?.platformName);
  const bg = g ? art.fanart ?? art.cover ?? g.coverUrl : null;
  const p = useGameProgress(g);
  return (
    <>
      <div className="p5-art">{bg ? <img src={bg} alt="" /> : <div className="p5-glow" />}</div>
      <div className="p5-top">
        {TOP.map(([k, l], j) => {
          const on = z === 'top' && st.di === j;
          if (k === 'games' || k === 'cat') return <button key={k} className={`p5-tab ${k === 'games' ? 'cur' : ''} ${on ? 'on' : ''}`} onClick={() => onTop(j)}>{l}</button>;
          if (k === 'ach') return <button key={k} className={`p5-av ${on ? 'on' : ''}`} aria-label={tt('Conquistas')} onClick={() => onTop(j)}>{me.initial}</button>;
          return <button key={k} className={`i ${on ? 'on' : ''}`} aria-label={k} onClick={() => onTop(j)}><Ic n={l as IconName} />{k === 'news' && feedCount > 0 && <span className="n">{feedCount}</span>}</button>;
        }).reduce<ReactNode[]>((a, x, j) => (j === 2 ? [...a, <span key="sp" className="sp" />, x] : [...a, x]), [])}
        <span className="p5-brand">{tt('Cosmo')}</span>
        <span className="p5-clock">{clock}</span>
      </div>
      <div className="p5-row" onWheel={wheelNav('h')} style={{ transform: `translateX(-${Math.max(0, i - 2) * 126 + (split && Math.max(0, i - 2) >= split ? SEC_GAP : 0)}px)` }}>
        {row.map((x, k) => (
          <button key={x.key} className={`p5-t ${k === i ? 'on' : ''} ${x.installed?.missing ? 'missing' : ''} ${split && k === split ? 'sec' : ''}`} aria-label={x.title} onClick={e => onTile(k, e)}>
            {split > 0 && (k === 0 || k === split) && <span className="p5-sec">{k ? tt('Coleção') : tt('Jogados recentemente')}</span>}
            <Art g={x} v="square" />
            {x.installed?.running && <span className="run"><Ic n="play" /></span>}
            {k === i && z === 'row' && <span className="p5-lab">{x.title}</span>}
          </button>
        ))}
        <button className={`p5-t add ${i === n ? 'on' : ''} ${split && n === split ? 'sec' : ''}`} aria-label={tt('Descobrir')} onClick={() => onTile(n)}>
          <Ic n="plus" />{i === n && z === 'row' && <span className="p5-lab">{tt('Descobrir')}</span>}
        </button>
      </div>
      {g ? (
        <div className="p5-hero">
          <h1>{g.title}</h1>
          <p>
            {g.status ? `${STATUS_LABEL[g.status]} · ` : ''}
            {g.installed?.missing ? (g.installed?.uninstalled ? tt('não instalado') : tt('pasta do jogo não encontrada')) : g.installed?.running ? tt('jogando agora') : g.installed?.playMs ? tt('{0} jogadas{1}', { 0: fmtPlay(g.installed.playMs), 1: g.installed.lastPlayed ? tt(' · última vez {0}', { 0: ago(g.installed.lastPlayed) }) : '' }) : tt('ainda não jogado')}
          </p>
          {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
          <div className="p5-acts">
            <button className={`p5-b pri ${z === 'acts' && st.ai === 0 ? 'on' : ''}`} onClick={() => onAct(0)}>{primary}</button>
            <button className={`p5-b icon ${z === 'acts' && st.ai === 1 ? 'on' : ''}`} aria-label={tt('Opções')} onClick={() => onAct(1)}><Ic n="dots" /></button>
          </div>
        </div>
      ) : (
        <div className="p5-hero">
          <h1>{n ? tt('Descobrir') : tt('Nenhum jogo por aqui ainda')}</h1>
          <p>{catCount ? tt('{0} de {1} no catálogo.{2}', { 0: plural(catCount, tt('recomp'), tt('recomps')), 1: c, 2: self ? tt(' Você instala por conta própria e adiciona a pasta aqui.') : '' }) : tt('O radar avisa quando aparecer o primeiro.')}</p>
          <div className="p5-acts"><button className={`p5-b pri ${z === 'acts' ? 'on' : ''}`} onClick={() => onAct(0)}>{tt('Abrir Descobrir')}</button></div>
        </div>
      )}
      {g && <Cards g={g} st={st} self={self} feed={feed} onCard={onCard} />}
      {hints}
      {menu}
    </>
  );
}

function Cards({ g, st, self, feed, onCard }: { g: HubGame; st: St; self: boolean; feed: { kind: 'new' | 'upd' | 'up'; detail: string; at: number } | null; onCard: (j: number) => void }) {
  const trpc = useTRPC();
  const inst = g.installed;
  const stats = useQuery(trpc.play.stats.queryOptions({ id: inst?.id ?? '' }, { enabled: !!inst }));
  const d = stats.data?.days ?? [], m = Math.max(...d, 0.01), week = d.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
  const a = inst?.achievements;
  const C = ({ k, children }: { k: number; children: ReactNode }) =>
    <button className={`p5-c ${st.zone === 'cards' && st.ci === k ? 'on' : ''}`} onClick={() => onCard(k)}>{children}</button>;
  return (
    <div className="p5-cards">
      <C k={0}>
        <small><Ic n="medal" />{' '}{tt('Conquistas')}</small>
        {a?.total ? <><b>{a.unlocked}/{a.total}</b><span>{tt('{0}% completo', { 0: Math.round((a.unlocked / a.total) * 100) })}</span><div className="bar"><i style={{ width: `${(a.unlocked / a.total) * 100}%` }} /></div></>
          : <><b>—</b><span>{inst?.adapter ? tt('Nenhuma ainda') : tt('Sem conquistas para este jogo')}</span></>}
      </C>
      <C k={1}>
        <small><Ic n="clock" />{' '}{tt('Tempo de jogo')}</small>
        <b>{inst ? fmtPlay(inst.playMs) || '0m' : '—'}</b>
        <span>{inst ? tt('{0} nesta semana', { 0: fmtPlay(week) || '0m' }) : tt('Ainda não jogado')}</span>
        {inst && d.length > 0 && <div className="mb">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(6, (v / m) * 100) : 3}%` }} />)}</div>}
      </C>
      <C k={2}>
        <small><Ic n="bell" />{' '}{tt('Novidades')}</small>
        <b>{feed ? SHORT[feed.kind] : '—'}</b>
        <span>{feed ? `${feed.detail ? feed.detail + ' · ' : ''}${ago(feed.at)}` : tt('Nada novo para este jogo')}</span>
      </C>
      <C k={3}>
        <small><Ic n="dl" />{' '}{tt('Versão')}</small>
        <b>{g.update?.installed ?? inst?.version ?? '—'}</b>
        <span>{self ? tt('Atualizações por sua conta') : g.update?.updateAvailable ? tt('{0} disponível', { 0: g.update.latest?.tag }) : inst ? (g.update?.updateAvailable === false ? tt('Em dia') : tt('Versão desconhecida')) : tt('Não instalado')}</span>
      </C>
    </div>
  );
}
