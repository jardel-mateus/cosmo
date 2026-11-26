import { useProfile } from '../lib/profile';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { semArquivos, tileClick } from '@shared/gameclick';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, RadarEvent } from '@shared/types';
import { isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, PAD_NAMES, useKeys, usePadKind, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover, type DOpt } from '../components/Discover';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { uninstallMsg, useFeed, useGameProgress, useHubActions, useHubData, type HubGame } from './data';
import { wheelNav } from './wheel';
import { tt } from '@shared/i18n';

type Page = 'home' | 'cat' | 'news' | 'time' | 'upd' | 'cfg' | 'game';
type Zone = 'row' | 'dock' | 'side' | 'main';
interface St { page: Page; zone: Zone; idx: number; di: number; si: number; mi: number; game: string | null; from: Page | null; fromSi?: number; lastZone: Zone }
type Side = { k: string; l: string; ic?: IconName; n?: number; gap?: boolean; v?: string };

const DOCK: [Page | 'off', string, IconName, string][] = [
  ['news', tt('Novidades'), 'bell', '#2f7de1'], ['cat', tt('Descobrir'), 'compass', '#ef7d22'], ['time', tt('Tempo'), 'clock', '#2fa45a'],
  ['upd', tt('Atualizações'), 'dl', '#8b5cf6'], ['cfg', tt('Ajustes'), 'gear', '#6b6b75'], ['off', tt('Sair'), 'power', '#6b6b75'],
];
const PAGES: Record<Exclude<Page, 'home' | 'game'>, [string, IconName]> = { cat: [tt('Descobrir'), 'compass'], news: [tt('Novidades'), 'bell'], time: [tt('Tempo de jogo'), 'clock'], upd: [tt('Atualizações'), 'dl'], cfg: [tt('Configurações'), 'gear'] };
const TAGS = { new: tt('NOVO'), upd: tt('VERSÃO'), up: tt('SUBIU') } as const;
const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} done={!!g.installed?.achievements?.complete} />;

export function SwitchHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const me = useProfile();
  const v1 = id === 'switch';
  const self = isSelfInstall(id);
  const c = CONSOLES.find(x => x.id === id)!;
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const [toast, show] = useHubToast();
  const [dst, setDst] = useState(initialDiscover);
  const [launch, setLaunch] = useState<HubGame | null>(null);
  const [st, set] = useState<St>(() => ({ page: game0 ? 'game' : tab === 'cat' ? 'cat' : 'home', zone: game0 ? 'side' : tab === 'cat' ? 'main' : 'row', idx: 0, di: 0, si: !game0 && tab === 'cat' ? 1 : 0, mi: 0, game: game0 ?? null, from: game0 ? 'home' : null, lastZone: 'row' }));
  const up = (p: Partial<St>) => set(s => ({ ...s, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(s => ({ ...s, page: 'cat', si: 0, mi: 0, zone: 'main', game: null, from: null })); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);
  const s = useSettings();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('click'); const t = setTimeout(() => sfx.play('boot'), 150); return () => { clearTimeout(t); setSfxProfile('soft'); }; }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);

  const row = data.lib;
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(g => [[g.key, g] as const, ...(g.installed && g.catalog ? [[g.catalog.id, g] as const] : [])])), [data.lib, data.catalog]);
  const game = st.game ? all.get(st.game) ?? null : null;
  useEffect(() => { if (st.page === 'game' && st.game && all.size && !all.has(st.game)) up({ page: 'home', zone: 'row', game: null, from: null }); }, [st.page, st.game, all]);
  const timeList = data.lib.filter(g => g.installed!.playMs > 0).sort((a, b) => b.installed!.playMs - a.installed!.playMs);

  const side: Side[] = (() => {
    const p = st.page;
    if (p === 'cat') {
      const cnt = (f: (g: HubGame) => boolean) => String(data.catalog.filter(f).length);
      return [{ k: 'search', l: tt('Buscar'), ic: 'search' }, { k: 'all', l: tt('Todos'), ic: 'grid', v: String(data.catalog.length) }, { k: 'new', l: tt('Novos'), ic: 'star', n: data.catalog.filter(g => g.isNew).length },
        { k: 'full', l: tt('Totalmente jogáveis'), ic: 'play', v: cnt(g => g.status === 'full') }, { k: 'play', l: tt('Jogáveis'), ic: 'pad', v: cnt(g => g.status === 'play') },
        { k: 'wip', l: tt('Em progresso'), ic: 'refresh', v: cnt(g => g.status === 'wip') }, { k: 'inst', l: tt('Já instalados'), ic: 'folder', gap: true, v: cnt(g => !!g.installed) }];
    }
    if (p === 'news') return [{ k: 'all', l: tt('Tudo'), n: data.feed.length }, { k: 'new', l: tt('Novos no catálogo') }, { k: 'upd', l: tt('Versões novas') }, { k: 'up', l: tt('Mudou de status') }];
    if (p === 'time') return [{ k: 'sum', l: tt('Resumo'), ic: 'chart' }, ...timeList.map((g, i) => ({ k: 'g:' + g.key, l: g.title, gap: i === 0, v: fmtPlay(g.installed!.playMs) }))];
    if (p === 'upd') return self ? [{ k: 'all', l: tt('Atualizações'), ic: 'dl' }] : [{ k: 'all', l: tt('Atualizações disponíveis'), ic: 'dl', n: data.withUpdate.length }, { k: 'check', l: act.checking ? tt('Verificando…') : tt('Verificar agora'), ic: 'refresh' }];
    if (p === 'cfg') return [{ k: 'dir', l: tt('Pasta dos jogos'), ic: 'folder' }, { k: 'snd', l: tt('Sons da interface'), ic: 'sound', v: s.snd ? tt('Ligados') : tt('Desligados') }, { k: 'radar', l: tt('Radar de novidades'), ic: 'bell' }, { k: 'about', l: tt('Sobre o Cosmo'), ic: 'info', gap: true }];
    return [];
  })();
  const sk = side[st.si]?.k;
  const catList = (() => {
    const k = st.page === 'cat' ? sk : 'all';
    if (k === 'new') return data.catalog.filter(g => g.isNew);
    if (k === 'full' || k === 'play' || k === 'wip') return data.catalog.filter(g => g.status === k);
    if (k === 'inst') return data.catalog.filter(g => g.installed);
    if (k === 'search') return query.trim() ? [...data.catalog, ...data.lib.filter(g => !g.catalog)].filter(g => matchesQuery(query, g.title, g.platformName, g.catalog?.developer)) : [];
    return data.catalog;
  })();
  const mainList = st.page === 'cat' ? catList : st.page === 'upd' && sk === 'all' ? data.withUpdate : [];
  const newsList = st.page === 'news' ? data.feed.filter(f => sk === 'all' || f.kind === sk) : [];
  const feed = useFeed(newsList, st.page === 'news');
  useEffect(() => { if (st.page === 'news' && st.zone === 'main' && st.mi >= newsList.length) up(newsList.length ? { mi: newsList.length - 1 } : { zone: 'side', mi: 0 }); }, [st.page, st.zone, st.mi, newsList.length]);
  const newsGame = (f: RadarEvent | undefined) => (f ? data.catalog.find(g => g.catalog?.id === f.gameId) ?? null : null);
  const wide = st.page === 'cat' && st.zone === 'main';
  const cols = st.page === 'cat' ? (wide ? 5 : 2) : 1;

  const open = (page: Page, extra: Partial<St> = {}) => { sfx.play('ok'); up({ page, si: page === 'cat' ? 1 : 0, mi: 0, zone: page === 'cat' ? 'main' : 'side', ...extra }); };
  const doPrimary = (g: HubGame) => {
    const r = act.primary(g);
    if (r === 'play') { sfx.play('ok'); setLaunch(g); setTimeout(() => setLaunch(null), 1600); show(tt('{0} aberto · o tempo de jogo começou a contar', { 0: g.title })); }
    else if (r === 'install') { sfx.play('ok'); show(tt('Baixando {0} do GitHub…', { 0: g.repo })); }
    else if (r === 'add') { sfx.play('ok'); show(tt('Escolha a pasta onde você instalou o jogo')); }
    else if (r === 'pick') { show(tt('Escolha qual programa abre o jogo')); chooseExe.mutate({ id: g.installed!.id }); }
    else if (r === 'relink') show(tt('A pasta do jogo sumiu: escolha onde ele está agora'));
  };
  const openHome = (g: HubGame) => open('game', { game: g.key, from: 'home', lastZone: 'row' });
  const openPage = (g: HubGame) => { sfx.play('ok'); openHome(g); };
  const doUpdate = (g: HubGame) => { sfx.play('ok'); act.update(g); show(tt('Atualizando {0} para {1}… configurações e saves ficam', { 0: g.title, 1: g.update?.latest?.tag })); };
  const enter = () => {
    const p = st.page;
    if (p === 'home') {
      if (st.zone === 'dock') { const k = DOCK[st.di]![0]; if (k === 'off') { sfx.play('back'); return onBack(); } return open(k); }
      const g = row[st.idx]; if (!g) return open('cat');
      if (semArquivos(g)) return openPage(g);
      return doPrimary(g);
    }
    if (p === 'cat' && st.zone === 'side' && sk === 'search') { sfx.play('ok'); searchRef.current?.focus(); return; }
    if (st.zone === 'side' && mainList.length && (p === 'cat' || (p === 'upd' && sk === 'all'))) { sfx.play('move'); return up({ zone: 'main', mi: 0 }); }
    if (p === 'news' && st.zone === 'side' && newsList.length) { sfx.play('move'); return up({ zone: 'main', mi: 0 }); }
    if (p === 'news' && st.zone === 'main') {
      const f = newsList[st.mi], g = newsGame(f); if (!f) return;
      feed.done(f);
      if (g) return open('game', { game: g.key, from: 'news', fromSi: st.si });
      return sfx.play('ok');
    }
    if (st.zone === 'main') {
      const g = mainList[st.mi]; if (!g) return;
      if (p === 'cat') return open('game', { game: g.key, from: 'cat', fromSi: st.si });
      if (p === 'upd') return doUpdate(g);
    }
    if (p === 'upd' && sk === 'check') { sfx.play('ok'); return act.checkAll(data.lib); }
    if (p === 'cfg' && sk === 'dir') { sfx.play('ok'); return pickDir.mutate(); }
    if (p === 'cfg' && sk === 'snd') { setSettings({ snd: !getSettings().snd }); return sfx.play('ok'); }
    sfx.play('move');
  };
  const back = () => {
    if (st.page === 'home') { if (st.zone === 'dock') { sfx.play('back'); return up({ zone: 'row', lastZone: 'row' }); } sfx.play('back'); return onBack(); }
    sfx.play('back');
    if (st.zone === 'main') return up({ zone: 'side' });
    up({ page: 'home', zone: st.lastZone === 'dock' ? 'dock' : 'row' });
  };

  const dOpts = (x: HubGame): DOpt[] => [
    ...(x.installed ? [{ k: 'primary', l: x.installed.running ? tt('Voltar para o jogo') : tt('Jogar') }, ...(x.installed.running ? [{ k: 'quit', l: tt('Fechar o jogo') }] : [])] : x.repo && !self ? [{ k: 'primary', l: tt('Instalar') }] : []),
    ...(!x.installed ? [{ k: 'add', l: self ? tt('Já instalei: adicionar pasta') : tt('Escolher pasta') }] : []),
    ...(x.repo ? [{ k: 'gh', l: tt('Ver no GitHub') }] : []),
  ];
  const dRun = (k: string, x: HubGame) => { if (k === 'add') { sfx.play('ok'); act.addFolder(x); show(tt('Escolha a pasta onde você instalou o jogo')); } else if (k === 'gh') act.github(x); else if (k === 'quit') { act.quit(x); sfx.play('back'); show(tt('Fechando {0}…', { 0: x.title })); } else doPrimary(x); };

  const gOpts = (g: HubGame): DOpt[] => {
    const inst = g.installed;
    if (inst?.missing) return [...(g.repo && !self ? [{ k: 'reinstall', l: tt('Instalar de novo') }] : []), { k: 'relink', l: inst.uninstalled ? tt('Já instalei de novo: mostrar a pasta') : tt('Procurar a pasta') }, { k: 'remove', l: tt('Remover da biblioteca') }];
    if (!inst) return [self ? { k: 'add', l: tt('Já instalei: adicionar pasta') } : { k: 'install', l: tt('Instalar') }, ...(!self ? [{ k: 'add', l: tt('Escolher pasta') }] : []), ...(g.repo ? [{ k: 'gh', l: tt('Ver no GitHub') }] : [])];
    return [inst.running ? { k: 'play', l: tt('Voltar para o jogo') } : inst.exe ? { k: 'play', l: tt('Jogar') } : { k: 'exe', l: tt('Escolher o .exe') }, ...(inst.running ? [{ k: 'quit', l: tt('Fechar o jogo') }] : []),
      ...(g.update?.updateAvailable && !self ? [{ k: 'ver', l: tt('Atualizar para {0}', { 0: g.update.latest?.tag }) }] : []),
      { k: 'folder', l: tt('Abrir pasta') }, ...(inst.exe ? [{ k: 'exe', l: tt('Trocar o .exe') }] : []), ...(g.repo ? [{ k: 'gh', l: tt('Ver no GitHub') }] : []),
      ...(!inst.running ? [{ k: 'uninstall', l: tt('Desinstalar') }, { k: 'remove', l: tt('Remover da biblioteca') }] : [])];
  };
  const gRun = (k: string, g: HubGame) => {
    if (k === 'quit') { act.quit(g); sfx.play('back'); return show(tt('Fechando {0}…', { 0: g.title })); }
    if (k === 'play' || k === 'install') return doPrimary(g);
    if (k === 'add') { sfx.play('ok'); act.addFolder(g); return show(tt('Escolha a pasta onde você instalou o jogo')); }
    if (k === 'exe') { sfx.play('ok'); return chooseExe.mutate({ id: g.installed!.id }); }
    if (k === 'reinstall') { sfx.play('ok'); act.reinstall(g); return show(tt('Baixando {0} de novo… o tempo de jogo continua', { 0: g.repo })); }
    if (k === 'relink') { sfx.play('ok'); act.relink(g); return show(tt('Escolha onde o jogo está agora')); }
    if (k === 'uninstall') { sfx.play('ok'); void act.uninstall(g).then(r => { if (!r) return; show(uninstallMsg(r, g.title)); up({ page: 'home', zone: 'row', game: null, from: null }); }); return; }
    if (k === 'remove') { sfx.play('back'); void act.remove(g).then(ok => { if (!ok) return; show(tt('{0} saiu da biblioteca', { 0: g.title })); up({ page: 'home', zone: 'row', game: null, from: null }); }); return; }
    if (k === 'folder') { sfx.play('ok'); return openFolder.mutate({ id: g.installed!.id }); }
    if (k === 'gh') { sfx.play('ok'); return act.github(g); }
    if (k === 'ver') return doUpdate(g);
  };
  const closeGame = () => {
    if (st.from && st.from !== 'home') return up({ page: st.from, from: null, zone: 'main', si: st.fromSi ?? 0 });
    up({ page: 'home', zone: st.lastZone === 'dock' ? 'dock' : 'row' });
  };

  useKeys((k: Key) => {
    if (launch) return;
    if (k === 'Escape') return back();
    if (k === 'Enter') return enter();
    if (st.page === 'news' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && st.zone === 'main' && feed.drop(newsList[st.mi])) up({ mi: Math.max(0, Math.min(st.mi, newsList.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (k === 'X' || k === 'Y') {
      if (st.page === 'home' && st.zone === 'row' && row[st.idx]) return open('game', { game: row[st.idx]!.key, from: 'home', lastZone: 'row' });
      return;
    }
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (st.page === 'home') {
      const n = row.length + 1;
      if (st.zone === 'row') {
        if (k === 'ArrowRight' && st.idx < n - 1) mv({ idx: st.idx + 1 });
        else if (k === 'ArrowLeft' && st.idx > 0) mv({ idx: st.idx - 1 });
        else if (k === 'ArrowDown') mv({ zone: 'dock', lastZone: 'dock' });
      } else {
        if (k === 'ArrowRight' && st.di < DOCK.length - 1) mv({ di: st.di + 1 });
        else if (k === 'ArrowLeft' && st.di > 0) mv({ di: st.di - 1 });
        else if (k === 'ArrowUp') mv({ zone: 'row', lastZone: 'row' });
      }
      return;
    }
    if (st.zone === 'side') {
      if (k === 'ArrowDown' && st.si < side.length - 1) mv({ si: st.si + 1, mi: 0 });
      else if (k === 'ArrowUp' && st.si > 0) mv({ si: st.si - 1, mi: 0 });
      else if (k === 'ArrowRight' && (mainList.length || newsList.length)) mv({ zone: 'main', mi: 0 });
      return;
    }
    const n = st.page === 'news' ? newsList.length : mainList.length;
    if (k === 'ArrowLeft') { if (st.mi % cols === 0) mv({ zone: 'side' }); else mv({ mi: st.mi - 1 }); }
    else if (k === 'ArrowRight' && cols > 1 && st.mi < n - 1) mv({ mi: st.mi + 1 });
    else if (k === 'ArrowDown' && st.mi + cols < n) mv({ mi: st.mi + cols });
    else if (k === 'ArrowUp' && st.mi - cols >= 0) mv({ mi: st.mi - cols });
  }, !(st.page === 'cat' || st.page === 'game'));

  const hints: [Parameters<typeof Glyph>[0]['a'], string][] = (() => {
    if (st.page === 'home') {
      if (st.zone === 'dock') return [['ok', 'OK']];
      const g = row[st.idx];
      if (!g) return [['ok', tt('Descobrir')]];
      return [['x', tt('Detalhes')], ['ok', g.installed?.missing ? tt('Opções') : g.installed?.running ? tt('Voltar ao jogo') : g.installed ? (v1 ? tt('Iniciar') : tt('Jogar')) : tt('Instalar')]];
    }
    if (st.zone === 'main' && st.page === 'news') return [['back', tt('Voltar')], ['y', tt('Limpar tudo')], ['x', tt('Dispensar')], ['ok', tt('Ver')]];
    if (st.zone === 'main') return [['back', tt('Voltar')], ['ok', st.page === 'cat' ? tt('Ver') : tt('Atualizar')]];
    if (st.page === 'cat' && sk === 'search') return [['back', tt('Voltar')], ['ok', tt('Digitar')]];
    return [['back', tt('Voltar')], ['ok', 'OK']];
  })();
  const Hints = () => <div className="s2h">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;

  return (
    <section className="view hub sk-tiles2" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`s2 ${v1 ? 'v1' : ''} ${wide ? 'wide' : ''}`} style={{ ['--cc' as string]: c.color }}>
        <div className="s2-in">
          {st.page === 'cat'
            ? <Discover theme="d-s2" cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
                options={dOpts} run={dRun} onOpen={x => open('game', { game: x.key, from: 'cat', fromSi: 0 })} onBack={() => { sfx.play('back'); up({ page: 'home', zone: 'row' }); }} />
            : st.page === 'game'
            ? game && <GameView theme="d-s2" g={game} self={self} opts={gOpts(game)} run={gRun} onBack={closeGame}
                />
            : st.page === 'home'
            ? <Home v1={v1} row={row} split={data.recent} st={st} feedCount={data.feed.length} updCount={data.withUpdate.length} newCount={data.catalog.filter(g => g.isNew).length}
                onTile={(i, e) => {
                  const g = row[i];
                  if (e && g) return tileClick(e, g, { select: () => { if (st.zone !== 'row' || st.idx !== i) { sfx.play('move'); up({ zone: 'row', idx: i }); } }, page: () => openHome(g), play: () => doPrimary(g) });
                  if (st.zone === 'row' && st.idx === i) enter(); else { sfx.play('move'); up({ zone: 'row', idx: i }); }
                }}
                onDock={j => { const k = DOCK[j]![0]; if (k === 'off') { sfx.play('back'); onBack(); } else open(k); }} hints={<Hints />} />
            : (
              <>
                <div className="hd">
                  <Ic n={PAGES[st.page as keyof typeof PAGES][1]} />
                  <span>{PAGES[st.page as keyof typeof PAGES][0]}</span>
                  <span className="sp" /><div className="av" title={me.name}>{me.initial}</div>
                </div>
                <nav className="side">
                  <div className="side-in" style={{ transform: `translateY(-${Math.max(0, st.si - 6) * 92}px)` }}>
                    {side.map((x, j) => (
                      <button key={x.k} title={x.l} className={`si ${j === st.si ? (st.zone === 'side' ? 'on' : 'sel') : ''} ${x.gap ? 'gap' : ''}`}
                        onClick={() => { if (st.si === j && st.zone === 'side') enter(); else { sfx.play('move'); up({ zone: 'side', si: j, mi: 0 }); } }}>
                        {x.ic && <Ic n={x.ic} />}<span>{x.l}</span>{x.n ? <span className="n">{x.n}</span> : x.v ? <span className="v">{x.v}</span> : null}
                      </button>
                    ))}
                  </div>
                </nav>
                <div className="vr" />
                <div className="main">
                  <div className="page-in" key={st.page + sk}>
                    <Main page={st.page} k={sk} st={st} cols={cols} self={self} query={query} setQuery={setQuery} searchRef={searchRef}
                      onSearchDone={() => { if (catList.length) up({ zone: 'main', mi: 0 }); }} data={data} catList={catList} timeList={timeList} game={game} c={c.name}
                      onCard={i => { if (st.zone === 'main' && st.mi === i) enter(); else { sfx.play('move'); up({ zone: 'main', mi: i }); } }} />
                  </div>
                </div>
                <div className="ft"><PadIndicator v1={v1} /><Hints /></div>
              </>
            )}
          {launch && <div className="launch"><Art g={launch} v="square" /></div>}
          {toast}
        </div>
      </Fit>
      <BootOverlay kind="tiles" />
    </section>
  );
}

function Home({ v1, row, split, st, feedCount, updCount, newCount, onTile, onDock, hints }: {
  v1: boolean; row: HubGame[]; split: number; st: St; feedCount: number; updCount: number; newCount: number; onTile: (i: number, e?: MouseEvent) => void; onDock: (j: number) => void; hints: ReactNode;
}) {
  const me = useProfile();
  const clock = useClock();
  const P = v1 ? 392 : 394, X0 = v1 ? 104 : 150, n = row.length, inDock = st.zone === 'dock', i = st.idx;
  // Jogados recentemente e coleção: um espaço com um traço separa as duas partes da fileira.
  const gap = (k: number) => (split && k >= split ? SEC_GAP : 0);
  const shift = Math.max(0, i - 2) * P + gap(Math.max(0, i - 2)), x = X0 + i * P + gap(i) - shift, g = row[i];
  return (
    <>
      <div className="top">
        <div className="av" title={me.name}>{me.initial}</div>
        <span className="brand">{tt('Cosmo')}<small>{v1 ? tt('Nintendo Switch') : tt('Nintendo Switch 2')}</small></span>
        <div className="sp" />
        {feedCount > 0 && <span className="radar"><i />{plural(feedCount, tt('novidade'), tt('novidades'))}</span>}
        <span className="clock">{clock}</span>
      </div>
      {!inDock && n > 0 && <div className="tname" style={{ left: x }}>{g ? g.title : tt('Descobrir mais')}</div>}
      <div className="row" onWheel={wheelNav('h')} style={{ transform: `translateX(-${shift}px)` }}>
        {row.map((t, k) => <Tile key={t.key} g={t} on={!inDock && k === i} first={k === 0} onClick={e => onTile(k, e)}
          sec={split && k === 0 ? tt('Jogados recentemente') : split && k === split ? tt('Coleção') : undefined} split={!!split && k === split} />)}
        {n === 0
          ? <button className={`tile all empty ${!inDock ? 'on' : ''}`} onClick={() => onTile(0)}>
              <Ic n="compass" /><b>{tt('Nenhum jogo por aqui ainda')}</b><span>{tt('Descubra recomps para instalar em Descobrir')}</span>
            </button>
          : <button className={`tile all ${!inDock && i === n ? 'on' : ''} ${split && split === n ? 'split' : ''}`} onClick={() => onTile(n)}><Ic n="compass" />{tt('Descobrir mais')}</button>}
      </div>
      {!inDock && g && <Meta g={g} x={x} />}
      <nav className="dock">
        {DOCK.map(([k, l, ic, col], j) => {
          const cnt = k === 'news' ? feedCount : k === 'upd' ? updCount : k === 'cat' ? newCount : 0;
          return (
            <button key={k} className={`dk ${inDock && j === st.di ? 'on' : ''}`} style={{ ['--ic' as string]: col }} aria-label={l} onClick={() => onDock(j)}>
              <Ic n={ic} /><span className="lb">{l}</span>{cnt > 0 && <span className="n">{cnt}</span>}
            </button>
          );
        })}
      </nav>
      <div className="foot"><PadIndicator v1={v1} label />{hints}</div>
    </>
  );
}

const SEC_GAP = 56;

function Tile({ g, on, first, onClick, sec, split }: { g: HubGame; on: boolean; first: boolean; onClick: (e: MouseEvent) => void; sec?: string; split?: boolean }) {
  const { initial } = useProfile();
  const p = useGameProgress(g);
  return (
    <button className={`tile ${g.installed && !g.installed.missing ? '' : 'off'} ${on ? 'on' : ''} ${split ? 'split' : ''}`} onClick={onClick} aria-label={g.title}>
      {sec && <span className="sec">{sec}</span>}
      <Art g={g} v="square" />
      {!g.installed && !p && <span className="dlb"><Ic n="dl" /></span>}
      {first && g.installed?.lastPlayed && !g.installed.running && <span className="cont"><b>{initial}</b>{tt('Continuar')}</span>}
      {g.installed?.running && <span className="cont run"><b>▶</b>{tt('Jogando')}</span>}
      {p && !p.error && <span className="tprog"><i style={{ width: `${Math.max(4, p.pct * 100)}%` }} /></span>}
    </button>
  );
}

function Meta({ g, x }: { g: HubGame; x: number }) {
  const p = useGameProgress(g), inst = g.installed;
  return (
    <div className="meta" style={{ left: x }}>
      {p ? <span>{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</span>
        : inst?.missing ? <span>{inst.uninstalled ? tt('Não instalado') : tt('Pasta do jogo não encontrada')}</span>
        : inst ? (inst.playMs ? <><span>{tt('Jogado')}{' '}<strong>{fmtPlay(inst.playMs)}</strong></span><span>{inst.lastPlayed ? ago(inst.lastPlayed) : ''}</span></> : <span>{tt('Ainda não jogado')}</span>)
        : <span>{g.isNew ? <span className="pill new">{tt('NOVO')}</span> : tt('Não instalado')}</span>}
      {g.status && <Chip s={g.status} />}
      {g.update?.updateAvailable && <span className="pill upd">UPDATE {g.update.latest?.tag}</span>}
    </div>
  );
}

const Chip = ({ s }: { s: NonNullable<HubGame['status']> }) => <span className={`chip ${s}`}>{STATUS_LABEL[s]}</span>;
const Pill = ({ g }: { g: HubGame }) => g.isNew ? <span className="pill new">{tt('NOVO')}</span> : g.update?.updateAvailable ? <span className="pill upd">UPDATE</span> : g.installed ? <span className="pill inst">{tt('INSTALADO')}</span> : null;
const Empty = ({ children }: { children: ReactNode }) => <div className="empty2">{children}</div>;

function Main({ page, k, st, cols, self, query, setQuery, searchRef, onSearchDone, data, catList, timeList, game, c, onCard }: {
  page: Page; k: string | undefined; st: St; cols: number; self: boolean; query: string; setQuery: (q: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void; data: ReturnType<typeof useHubData>; catList: HubGame[]; timeList: HubGame[]; game: HubGame | null; c: string; onCard: (i: number) => void;
}) {
  const trpc = useTRPC();
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const info = useQuery(trpc.catalog.info.queryOptions());
  const s = useSettings();

  if (page === 'cat' && k === 'search') {
    const r = Math.floor(st.mi / cols), pitch = cols > 2 ? 266 : 410;
    return (
      <div className="main-in" style={{ transform: `translateY(-${st.zone === 'main' ? Math.max(0, r - 1) * pitch : 0}px)` }}>
        <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="sbox" placeholder={tt('Nome do jogo…')} onDone={onSearchDone} />
        {!query.trim() ? <Empty>{tt('Digite o nome de um jogo de {0}: aparecem os seus e os do catálogo.', { 0: c })}</Empty>
          : !catList.length ? <Empty>{tt('Nada encontrado para “{0}”.', { 0: query.trim() })}</Empty>
          : <div className="cards">{catList.map((g, i) => (
              <button key={g.key} className={`card ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
                <Art g={g} v="wide" /><div className="ttl"><span>{g.title}</span><Pill g={g} /></div>
              </button>
            ))}</div>}
      </div>
    );
  }
  if (page === 'cat') {
    if (!catList.length) return <Empty>{data.catalog.length ? tt('Nada nessa categoria.') : tt('O catálogo ainda não tem recomps para {0}. O radar avisa quando aparecer o primeiro.', { 0: c })}</Empty>;
    const r = Math.floor(st.mi / cols), pitch = cols > 2 ? 266 : 410;
    return (
      <div className="main-in" style={{ transform: `translateY(-${st.zone === 'main' ? Math.max(0, r - 1) * pitch : 0}px)` }}>
        <div className="cards">{catList.map((g, i) => (
          <button key={g.key} className={`card ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
            <Art g={g} v="wide" /><div className="ttl"><span>{g.title}</span><Pill g={g} /></div>
          </button>
        ))}</div>
      </div>
    );
  }
  if (page === 'news') {
    const L = data.feed.filter(f => k === 'all' || f.kind === k);
    if (!L.length) return <Empty>{tt('Nada novo por aqui. O Cosmo confere o Recompendium toda vez que abre.')}</Empty>;
    const byId = new Map(data.catalog.map(g => [g.catalog!.id, g]));
    return <div className="main-in" style={{ transform: `translateY(-${st.zone === 'main' ? Math.max(0, st.mi - 3) * 156 : 0}px)` }}>{L.map((f, i) => { const g = byId.get(f.gameId); return (
      <div key={f.id} className={`nr ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>{g ? <Art g={g} v="cover" /> : <div />}
        <div>{f.title}<small>{f.kind === 'new' ? (g?.repo ?? '') : f.detail}</small></div>
        <div className="r"><span className={`pill ${f.kind}`}>{TAGS[f.kind]}</span>{ago(f.at)}</div></div>); })}</div>;
  }
  if (page === 'time') {
    if (!timeList.length) return <Empty>{tt('Nenhuma sessão ainda. O tempo começa a contar quando você abre um jogo por aqui.')}</Empty>;
    if (k === 'sum') {
      const max = Math.max(...timeList.map(g => g.installed!.playMs));
      return (
        <>
          <ConsoleBigs data={data} />
          {timeList.map(g => <div key={g.key} className="rank"><span>{g.title}</span><span>{fmtPlay(g.installed!.playMs)}</span><div className="bar"><i style={{ width: `${(g.installed!.playMs / max) * 100}%` }} /></div></div>)}
        </>
      );
    }
    const g = timeList.find(x => 'g:' + x.key === k);
    return g ? <GameTime g={g} /> : null;
  }
  if (page === 'upd') {
    if (k === 'check') return <div className="desc"><Ic n="refresh" /><div>{tt('Confere no GitHub se saiu versão nova dos seus jogos de {0}. O Cosmo já confere sozinho a cada 3 horas; aqui é para forçar agora.', { 0: c })}</div></div>;
    if (self) return <Empty>{tt('Neste console as atualizações são por sua conta: instale a versão nova do recomp por cima da pasta do jogo e o Cosmo continua contando o tempo e as conquistas.')}</Empty>;
    if (!data.withUpdate.length) return <Empty>{tt('Tudo em dia.{0}', { 0: data.lib.some(g => g.installed?.sourceRepo) ? '' : tt(' (Nenhum jogo deste console tem projeto do GitHub ligado.)') })}</Empty>;
    return <>{data.withUpdate.map((g, i) => (
      <button key={g.key} className={`nr nrb ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
        <Art g={g} v="cover" />
        <div>{g.title}<small>{g.repo} · {g.update?.installed ?? '?'} → {g.update?.latest?.tag}</small></div>
        <div className="r"><span className="pill upd">{g.update?.latest?.tag}</span><span><Glyph a="ok" />{tt('atualizar')}</span></div>
      </button>
    ))}</>;
  }
  if (page === 'cfg') {
    if (k === 'dir') return <><div className="desc"><Ic n="folder" /><div>{tt('Onde o Cosmo instala os jogos que você baixa. Os já instalados ficam onde estão.')}{' '}<Glyph a="ok" />{' '}{tt('para escolher outra pasta.')}</div></div><dl className="kv2"><dt>{tt('Pasta')}</dt><dd>{portsDir.data ?? '…'}</dd></dl></>;
    if (k === 'snd') return <><div className="desc"><Ic n="sound" /><div>{tt('Os sons de navegação de cada console.')}{' '}<Glyph a="ok" />{' '}{tt('liga ou desliga.')}</div></div><dl className="kv2"><dt>{tt('Sons')}</dt><dd>{s.snd ? tt('Ligados') : tt('Desligados')}</dd><dt>{tt('Volume')}</dt><dd>{s.vol}%</dd></dl></>;
    if (k === 'radar') return <><div className="desc"><Ic n="bell" /><div>{tt('O radar compara o catálogo do Recompendium com a última olhada e avisa jogos novos, mudanças de status e versões novas dos seus jogos.')}</div></div><dl className="kv2"><dt>{tt('Catálogo de')}</dt><dd>{info.data?.generatedAt ? fmtDate(Date.parse(info.data.generatedAt)) : '—'}</dd><dt>{tt('Conferido')}</dt><dd>{info.data?.checkedAt ? ago(info.data.checkedAt) : '—'}</dd></dl></>;
    return <div className="desc"><Ic n="info" /><div>{tt('Cosmo: hub de recomps, ports e emuladores. Catálogo do Recompendium; instalação adaptada do Harbour. Esta tela é inspirada no visual do {0}, sem nada copiado dele.', { 0: c })}</div></div>;
  }
  return null;
}

function ConsoleBigs({ data }: { data: ReturnType<typeof useHubData> }) {
  const played = data.lib.filter(g => g.installed!.playMs > 0);
  const top = [...played].sort((a, b) => b.installed!.playMs - a.installed!.playMs)[0];
  const last = Math.max(0, ...data.lib.map(g => g.installed!.lastPlayed ?? 0));
  return (
    <div className="bigs">
      <div className="big"><b>{fmtPlay(data.playMs)}</b><span>{tt('neste console')}</span></div>
      <div className="big"><b>{played.length}/{data.lib.length}</b><span>{tt('jogos jogados')}</span></div>
      <div className="big"><b>{last ? ago(last) : '—'}</b><span>{tt('última vez')}</span></div>
      <div className="big"><b className="ell">{top ? top.title : '—'}</b><span>{tt('mais jogado')}</span></div>
    </div>
  );
}

function GameTime({ g }: { g: HubGame }) {
  const trpc = useTRPC();
  const st = useQuery(trpc.play.stats.queryOptions({ id: g.installed!.id }));
  const d = st.data;
  if (!d) return null;
  const max = Math.max(...d.days, 0.01), wk = d.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
  return (
    <>
      <div className="bigs">
        <div className="big"><b>{fmtPlay(d.totalMs)}</b><span>{tt('tempo total')}</span></div>
        <div className="big"><b>{d.lastPlayed ? ago(d.lastPlayed) : '—'}</b><span>{tt('última vez')}</span></div>
        <div className="big"><b>{d.sessions}</b><span>{tt('sessões')}</span></div>
        <div className="big"><b>{d.avgMs ? fmtPlay(d.avgMs) : '—'}</b><span>{tt('por sessão')}</span></div>
      </div>
      <div className="ch2">
        <h4>{g.title}<span>{tt('{0} nesta semana', { 0: fmtPlay(wk) })}</span></h4>
        <div className="b14">{d.days.map((v, i) => <i key={i} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(3, (v / max) * 100) : 1}%` }} />)}</div>
        <div className="ax"><span>{tt('14 dias atrás')}</span><span>{tt('hoje')}</span></div>
      </div>
    </>
  );
}

function GameAch({ id }: { id: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.achievements.forGame.queryOptions({ id }));
  const d = q.data;
  if (!d) return null;
  const got = d.list.filter(a => a.unlockedAt != null).length;
  const list = [...d.list].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
  return (
    <>
      <div className="bigs"><div className="big"><b>{got}/{d.list.length}</b><span>{tt('conquistas')}</span></div>
        {d.list.some(a => a.points) && <div className="big"><b>{list.filter(a => a.unlockedAt != null).reduce((s, a) => s + (a.points ?? 0), 0)}</b><span>{tt('pontos')}</span></div>}</div>
      {d.errors.map(e => <div key={e} className="desc"><Ic n="info" /><div>{e}</div></div>)}
      {list.map(a => (
        <div key={a.id} className={`nr ach ${a.unlockedAt == null ? 'locked' : ''}`}>
          <div className="aico">{a.icon ? <img src={a.icon} alt="" /> : <Ic n="medal" />}</div>
          <div>{a.name}<small>{a.description}</small></div>
          <div className="r">{a.points != null && <span className="pill inst">{a.points} G</span>}{a.unlockedAt != null ? fmtDate(a.unlockedAt) : tt('Bloqueada')}</div>
        </div>
      ))}
    </>
  );
}

function PadIndicator({ label = false }: { v1?: boolean; label?: boolean }) {
  const kind = usePadKind();
  if (kind === 'kb') return (
    <span className="pad"><svg className="kbd" viewBox="0 0 64 40" aria-hidden="true">
      <rect x="3" y="7" width="58" height="28" rx="6" fill="currentColor" />
      {[0, 1, 2, 3, 4, 5, 6].map(i => <rect key={i} x={9 + i * 7} y="12" width="5" height="5" rx="1.2" fill="#ececef" />)}
      {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x={12 + i * 7} y="19" width="5" height="5" rx="1.2" fill="#ececef" />)}
      <rect x="16" y="26" width="32" height="4.5" rx="1.5" fill="#ececef" />
    </svg>{label && <small>{tt('Teclado')}</small>}</span>
  );
  return <span className="pad"><Ic n="pad" />{label && <small>{tt('Controle {0}', { 0: PAD_NAMES[kind] })}</small>}</span>;
}
