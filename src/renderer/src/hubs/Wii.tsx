import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { semArquivos, tileClick } from '@shared/gameclick';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, PlayStats, RadarEvent } from '@shared/types';
import { isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural, locale } from '../lib/format';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useFeed, useHubActions, useHubData, type HubGame, uninstallMsg } from './data';
import { wheelNav } from './wheel';
import { tt } from '@shared/i18n';

type Sp = 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type View = { kind: 'game'; key: string } | { kind: Sp };
type PZone = 'btns' | 'shots' | 'list';
interface St { page: number; ci: number; zone: 'grid' | 'bar'; bi: number; view: View | null; stack: { view: View; mi: number }[]; pz: PZone; pb: number; ps: number; mi: number; opt: boolean; oi: number }
interface Chan { key: string; g?: HubGame; sp?: Sp; l?: string; ic?: IconName; n?: number; gap?: boolean; recent?: boolean }
interface Row { key: string; g?: HubGame; ic?: IconName; t: string; s?: string; v?: string; id?: string; feed?: RadarEvent }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const SPECIAL: [Sp, string, IconName][] = [['cat', tt('Descobrir'), 'compass'], ['ach', tt('Conquistas'), 'medal'], ['time', tt('Tempo de jogo'), 'clock'], ['cfg', tt('Ajustes'), 'gear']];
const TITLE: Record<Sp, string> = { cat: tt('Descobrir'), news: tt('Novidades'), ach: tt('Conquistas'), time: tt('Tempo de jogo'), cfg: tt('Ajustes') };
const FEED = { new: tt('Novo no catálogo'), upd: tt('Versão nova'), up: tt('Mudou de status') } as const;
const CFG: Row[] = [
  { key: 'dir', id: 'dir', t: tt('Pasta dos jogos'), ic: 'folder' }, { key: 'snd', id: 'snd', t: tt('Sons da interface'), ic: 'sound' },
  { key: 'radar', id: 'radar', t: tt('Radar de novidades'), ic: 'bell' }, { key: 'off', id: 'off', t: tt('Voltar ao Cosmo'), ic: 'power' },
];
const PER = 12, COLS = 4, ROW_H = 110;

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} done={!!g.installed?.achievements?.complete} />;

export function WiiHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ page: 0, ci: 0, zone: 'grid', bi: 0, view: tab === 'cat' ? { kind: 'cat' } : null, stack: [], pz: tab === 'cat' ? 'list' : 'btns', pb: 0, ps: 0, mi: 0, opt: false, oi: 0 }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const [ptr, setPtr] = useState<{ x: number; y: number; down: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('bubble'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const [dst, setDst] = useState(initialDiscover);
  const focusSearch = () => { setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, view: { kind: 'cat' }, stack: [], pz: 'list', mi: 0, opt: false })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    const c = chans.findIndex(ch => ch.g === lib[i]);
    if (i >= 0 && c >= 0) { shown.current = true; up({ page: Math.floor(c / PER), ci: c % PER }); open({ kind: 'game', key: lib[i]!.key }); }
  }, [game0, lib.length]);
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const found = useMemo(() => query.trim() ? [...data.catalog, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : data.catalog, [data.catalog, data.lib, query]);

  // Jogados recentemente nas primeiras fileiras (com um relógio no canto); a coleção começa numa fileira nova.
  const split = data.recent, pad = split ? (COLS - (split % COLS)) % COLS : 0;
  const chans: Chan[] = [
    ...lib.slice(0, split).map(g => ({ key: g.key, g, recent: true })),
    ...Array.from({ length: pad }, (_, j) => ({ key: `gap${j}`, gap: true })),
    ...lib.slice(split).map(g => ({ key: g.key, g })),
    ...SPECIAL.map(([sp, l, ic]) => ({ key: sp, sp, l, ic, n: sp === 'cat' ? data.catalog.filter(x => x.isNew).length || undefined : undefined })),
  ];
  const pages = Math.max(1, Math.ceil(chans.length / PER));
  const pageChans = chans.slice(st.page * PER, st.page * PER + PER);
  const curChan = st.zone === 'grid' && !pageChans[st.ci]?.gap ? pageChans[st.ci] ?? null : null;
  /** Canal de verdade mais perto (os vãos depois dos recentes não recebem o cursor). */
  const solid = (ci: number, list = pageChans) => { let j = Math.min(ci, list.length - 1); while (j > 0 && list[j]?.gap) j--; return Math.max(0, j); };

  const view = st.view;
  const game = view?.kind === 'game' ? all.get(view.key) ?? null : null;
  const sp = view && view.kind !== 'game' ? view.kind : null;

  const rows: Row[] = sp === 'cat' ? found.map(g => ({ key: g.key, g, t: g.title, s: [g.status && STATUS_LABEL[g.status], g.catalog?.developer, g.catalog?.year].filter(Boolean).join(' · '), v: g.installed ? tt('Instalado') : g.isNew ? tt('Novo') : '' }))
    : sp === 'news' ? data.feed.map(f => { const g = data.catalog.find(y => y.catalog?.id === f.gameId); return { key: String(f.id), g, feed: f, t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''}`, v: ago(f.at) }; })
    : sp === 'ach' ? lib.map(g => ({ key: g.key, g, t: g.title, v: g.installed?.achievements?.total ? `${g.installed.achievements.unlocked}/${g.installed.achievements.total}` : '—' }))
    : sp === 'time' ? [{ key: 'sum', ic: 'chart' as IconName, t: tt('Resumo'), v: fmtPlay(data.playMs) || '0m' }, ...byPlay.map(g => ({ key: g.key, g, t: g.title, v: fmtPlay(g.installed?.playMs ?? 0) || '0m' }))]
    : sp === 'cfg' ? CFG.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? tt('Ligados') : tt('Desligados')) : '' }))
    : [];
  const row = rows[st.mi];
  const feed = useFeed(data.feed, sp === 'news');
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: row?.g?.installed?.id ?? '' }, { enabled: sp === 'ach' && !!row?.g?.installed?.adapter }));
  const statQ = useQueries({ queries: (sp === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(byPlay.map((x, i) => [x.key, statQ[i]?.data] as const));

  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    if (st.pz === 'shots') el.querySelector('.wi-shots')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else if (st.pz === 'list') el.querySelector('.wi-r.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.pz, st.mi]);

  const options = (x: HubGame): Opt[] => {
    const inst = x.installed;
    const L: Opt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: tt('Instalar de novo'), ic: 'dl' });
      L.push({ k: 'relink', l: inst.uninstalled ? tt('Já instalei de novo: mostrar a pasta') : tt('Procurar a pasta'), ic: 'folder' });
      L.push({ k: 'remove', l: tt('Remover da biblioteca'), ic: 'stop' });
    } else if (inst) {
      L.push(inst.running ? { k: 'play', l: tt('Voltar para o jogo'), ic: 'play' } : inst.exe ? { k: 'play', l: tt('Iniciar'), ic: 'play' } : { k: 'exe', l: tt('Escolher o .exe'), ic: 'folder' });
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
    return L;
  };
  const gameOpts = game ? options(game) : [];
  const btns: { k: string; l: string }[] = [{ k: 'menu', l: tt('Menu') }];

  const open = (v: View, extra: Partial<St> = {}) => {
    sfx.play('ok');
    set(x => ({ ...x, stack: x.view ? [...x.stack, { view: x.view, mi: x.mi }] : x.stack, view: v, pz: v.kind === 'game' ? 'btns' : 'list', pb: v.kind === 'game' ? 99 : 0, ps: 0, mi: 0, opt: false, oi: 0, ...extra }));
    bodyRef.current?.scrollTo({ top: 0 });
  };
  const closeView = (silent = false) => {
    if (!silent) sfx.play('back');
    set(x => {
      const prev = x.stack[x.stack.length - 1];
      if (!prev) return { ...x, view: null, stack: [], opt: false };
      return { ...x, view: prev.view, stack: x.stack.slice(0, -1), pz: prev.view.kind === 'game' ? 'btns' : 'list', mi: prev.mi, opt: false, pb: 99 };
    });
  };

  const run = (k: string, x: HubGame) => {
    up({ opt: false });
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
    if (k === 'uninstall') { void act.uninstall(x).then(r => { if (!r) return; up({ view: null, stack: [] }); show(uninstallMsg(r, x.title)); }); return; }
    if (k === 'remove') { void act.remove(x).then(ok => { if (!ok) return; up({ view: null, stack: [] }); show(tt('{0} saiu da biblioteca', { 0: x.title })); }); return; }
    if (k === 'update') { act.update(x); return show(tt('Atualizando para {0}… configurações e saves ficam', { 0: x.update?.latest?.tag })); }
    if (k === 'ach') return open({ kind: 'ach' }, { mi: Math.max(0, lib.indexOf(x)) });
    if (k === 'time') return open({ kind: 'time' }, { mi: Math.max(0, byPlay.indexOf(x) + 1) });
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
  };
  const openChan = (ch: Chan) => { if (ch.g) open({ kind: 'game', key: ch.g.key }); else if (ch.sp) { open({ kind: ch.sp }); } };
  const openPage = (x: HubGame) => { sfx.play('ok'); open({ kind: 'game', key: x.key }); };

  const enter = () => {
    if (!view) {
      if (st.zone === 'bar') { if (st.bi === 0) { sfx.play('back'); return onBack(); } return open({ kind: 'news' }); }
      if (curChan?.g && semArquivos(curChan.g)) return openPage(curChan.g);
      if (curChan) openChan(curChan);
      return;
    }
    if (st.pz === 'btns') return closeView();
    if (!row) return;
    if (sp === 'cfg') {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show(tt('O radar confere o catálogo do Recompendium toda vez que o Cosmo abre'));
    }
    if (row.feed) feed.done(row.feed);
    if (row.g) return open({ kind: 'game', key: row.g.key });
  };
  const back = () => {
    if (st.opt) { sfx.play('back'); return up({ opt: false }); }
    if (view) { if (sp === 'cat' && query) { sfx.play('back'); return setQuery(''); } return closeView(); }
    sfx.play('back'); onBack();
  };

  useKeys((k: Key) => {
    setPtr(null);
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (!view) {
      if (k === 'X' && curChan?.g) return open({ kind: 'game', key: curChan.g.key });
      if (k === 'LB' && st.page > 0) return mv({ page: st.page - 1, ci: 0 });
      if ((k === 'RB' || k === 'Tab') && st.page < pages - 1) return mv({ page: st.page + 1, ci: 0 });
      if (st.zone === 'bar') {
        if (L && st.bi > 0) mv({ bi: 0 }); else if (R && st.bi < 1) mv({ bi: 1 }); else if (U) mv({ zone: 'grid', ci: solid(st.ci) });
        return;
      }
      const col = st.ci % COLS, rowI = Math.floor(st.ci / COLS), gap = (j: number) => !!pageChans[j]?.gap;
      if (R) { if (col < COLS - 1 && st.ci + 1 < pageChans.length && !gap(st.ci + 1)) mv({ ci: st.ci + 1 }); else if (col === COLS - 1 && st.page < pages - 1) mv({ page: st.page + 1, ci: rowI * COLS }); return; }
      if (L) { if (col > 0) mv({ ci: st.ci - 1 }); else if (st.page > 0) { const prev = chans.slice((st.page - 1) * PER, st.page * PER); mv({ page: st.page - 1, ci: solid(rowI * COLS + COLS - 1, prev) }); } return; }
      if (U && rowI > 0) { let j = st.ci - COLS; while (j >= COLS && gap(j)) j -= COLS; return mv({ ci: gap(j) ? solid(j) : j }); }
      if (D) { let j = st.ci + COLS; while (j < pageChans.length && gap(j)) j += COLS; if (j < pageChans.length) mv({ ci: j }); else mv({ zone: 'bar', bi: col < 2 ? 0 : 1 }); }
      return;
    }
    if (sp === 'news' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && st.pz === 'list' && feed.drop(row?.feed)) up({ mi: Math.max(0, Math.min(st.mi, rows.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (st.pz === 'btns') { if (U && rows.length) mv({ pz: 'list' }); return; }
    if (D) { if (st.mi < rows.length - 1) mv({ mi: st.mi + 1 }); else mv({ pz: 'btns' }); }
    else if (U) { if (st.mi > 0) mv({ mi: st.mi - 1 }); else if (sp === 'cat') { sfx.play('ok'); searchRef.current?.focus(); } }
  }, !(view?.kind === 'cat' || game));

  const onMove = (e: React.MouseEvent) => {
    const r = rootRef.current?.getBoundingClientRect(); if (!r) return;
    setPtr(p => ({ x: ((e.clientX - r.left) / r.width) * 1920, y: ((e.clientY - r.top) / r.height) * 1080, down: p?.down ?? false }));
  };

  const hints: Hint[] = view && sp === 'news' && rows.length ? [['ok', tt('Abrir')], ['x', tt('Dispensar')], ['y', tt('Limpar tudo')], ['back', tt('Menu')]]
    : view ? [['ok', sp === 'cfg' ? tt('Confirmar') : tt('Abrir')], ['ud', tt('Escolher')], ['back', tt('Menu')]]
    : [['ok', tt('Abrir')], ...(curChan?.g ? [['x', tt('Opções')] as Hint] : []), ...(pages > 1 ? [['rb', tt('Página')] as Hint] : []), ['back', tt('Cosmo')]];
  const date = new Date().toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric' });

  return (
    <section className="view hub sk-wi" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className="wi" style={{ ['--cc' as string]: c.color }}>
        <div ref={rootRef} className="wi-root" onMouseMove={onMove} onMouseLeave={() => setPtr(null)}
          onMouseDown={() => setPtr(p => p && { ...p, down: true })} onMouseUp={() => setPtr(p => p && { ...p, down: false })}>
          <div className="wi-grid" key={st.page} onWheel={wheelNav('h')}>
            {Array.from({ length: PER }, (_, j) => {
              const ch = pageChans[j];
              if (!ch || ch.gap) return <div key={`e${j}`} className="wi-ch empty" />;
              const on = !view && st.zone === 'grid' && st.ci === j;
              return (
                <button key={ch.key} className={`wi-ch ${ch.sp ? 'special' : ''} ${on ? 'on' : ''} ${ch.g?.installed?.missing ? 'missing' : ''}`}
                  onMouseEnter={() => { if (!view && (st.zone !== 'grid' || st.ci !== j)) { sfx.play('move'); up({ zone: 'grid', ci: j }); } }}
                  onClick={e => {
                    if (ch.g) return tileClick(e, ch.g, { select: () => up({ zone: 'grid', ci: j }), page: () => openChan(ch), play: () => run('play', ch.g!) });
                    up({ zone: 'grid', ci: j }); openChan(ch);
                  }}>
                  {ch.g ? <><Art g={ch.g} v="wide" /><span className="shine" /><span className="lbl">{ch.g.title}</span></> : <><Ic n={ch.ic!} /><b>{ch.l}</b></>}
                  {ch.g?.installed?.running ? <span className="run"><Ic n="play" /></span> : ch.recent ? <span className="rc" title={tt('Jogado recentemente')}><Ic n="clock" /></span> : null}
                  {ch.n ? <span className="n">{ch.n}</span> : null}
                </button>
              );
            })}
          </div>
          {pages > 1 && <>
            <button className={`wi-pg l ${st.page === 0 ? 'off' : ''}`} onClick={() => { if (st.page > 0) { sfx.play('move'); up({ page: st.page - 1, ci: 0 }); } }}><Ic n="back" /></button>
            <button className={`wi-pg r ${st.page >= pages - 1 ? 'off' : ''}`} onClick={() => { if (st.page < pages - 1) { sfx.play('move'); up({ page: st.page + 1, ci: 0 }); } }}><Ic n="back" /></button>
          </>}
          <div className="wi-bar">
            <button className={`wi-round l ${!view && st.zone === 'bar' && st.bi === 0 ? 'on' : ''}`} onMouseEnter={() => { if (!view && (st.zone !== 'bar' || st.bi !== 0)) { sfx.play('move'); up({ zone: 'bar', bi: 0 }); } }} onClick={() => { sfx.play('back'); onBack(); }}><Ic n="home" />{tt('Cosmo')}</button>
            <div className="wi-clock">{clock}<small>{date}</small></div>
            <button className={`wi-round r ${!view && st.zone === 'bar' && st.bi === 1 ? 'on' : ''}`} onMouseEnter={() => { if (!view && (st.zone !== 'bar' || st.bi !== 1)) { sfx.play('move'); up({ zone: 'bar', bi: 1 }); } }} onClick={() => open({ kind: 'news' })}>
              <Ic n="bell" />{tt('Novidades')}{data.feed.length > 0 && <span className="n">{data.feed.length}</span>}
            </button>
            {pages > 1 && <div className="wi-dots">{Array.from({ length: pages }, (_, j) => <i key={j} className={j === st.page ? 'on' : ''} />)}</div>}
          </div>
          {view?.kind === 'cat' && (
            <Discover theme="d-wii" cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
              options={x => options(x).map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
              run={run} onOpen={x => open({ kind: 'game', key: x.key })} onBack={closeView} />
          )}
          {game && <GameView theme="d-wii" g={game} self={self} run={run} onBack={() => closeView(true)}
            opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />}
          {view && view.kind !== 'cat' && !game && (
            <div className="wi-prev" key={sp!}>
              <div className="wi-body" ref={bodyRef}>
                <SpecialBody sp={sp!} rows={rows} st={st} row={row} cname={c.name} catCount={data.catalog.length} query={query}
                    setQuery={v => { setQuery(v); up({ mi: 0 }); }} searchRef={searchRef} onSearchDone={() => { if (rows.length) up({ pz: 'list', mi: 0 }); }}
                    achList={ach.data?.list ?? []} achLoading={ach.isLoading} stats={row?.g ? stats.get(row.g.key) : undefined} statsAll={stats} lib={byPlay} playMs={data.playMs} sndOn={s.snd}
                    onRow={j => { if (st.pz === 'list' && st.mi === j) enter(); else { sfx.play('move'); up({ pz: 'list', mi: j }); } }} />
              </div>
              <div className="wi-btns">{btns.map((b, j) => {
                const on = st.pz === 'btns' && !st.opt && Math.min(st.pb, btns.length - 1) === j;
                return (
                  <button key={b.k} className={`${on ? 'on' : ''} ${b.k === 'start' ? 'go' : ''}`}
                    onClick={() => { if (on) enter(); else { sfx.play('move'); up({ pz: 'btns', pb: j }); } }}>{b.l}</button>
                );
              })}</div>
            </div>
          )}
          {view?.kind !== 'cat' && !game && <div className={`wi-hn ${view ? 'top' : ''}`}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>}
          {ptr && <div className={`wi-ir ${ptr.down ? 'press' : ''}`} style={{ left: ptr.x, top: ptr.y }} />}
          {toast}
        </div>
      </Fit>
      <BootOverlay kind="white" label={c.name.toUpperCase()} />
    </section>
  );
}

function SpecialBody({ sp, rows, st, row, cname, catCount, query, setQuery, searchRef, onSearchDone, achList, achLoading, stats, statsAll, lib, playMs, sndOn, onRow }: {
  sp: Sp; rows: Row[]; st: St; row: Row | undefined; cname: string; catCount: number; query: string; setQuery: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void; achList: AchievementView[]; achLoading: boolean;
  stats: PlayStats | undefined; statsAll: Map<string, PlayStats | undefined>; lib: HubGame[]; playMs: number; sndOn: boolean; onRow: (j: number) => void;
}) {
  const side = sp === 'ach' || sp === 'time' || sp === 'cfg';
  const list = (
    <div className="wi-list">
      {rows.length ? rows.map((r, j) => (
        <button key={r.key} className={`wi-r ${st.pz === 'list' && st.mi === j ? 'on' : ''}`} onClick={() => onRow(j)} style={{ minHeight: ROW_H }}>
          {r.g ? <span className="th"><Art g={r.g} v="square" /></span> : r.ic ? <span className="th ic"><Ic n={r.ic} /></span> : null}
          <span className="tx"><b>{r.t}</b>{r.s && <small>{r.s}</small>}</span>
          {r.v && <span className="v">{r.v}</span>}
        </button>
      )) : (
        <div className="wi-empty">
          {sp === 'cat' ? (query.trim() ? tt('Nada encontrado para “{0}”.', { 0: query.trim() }) : catCount ? tt('Nada por aqui.') : tt('O catálogo ainda não tem recomps para {0}. O radar avisa quando aparecer o primeiro.', { 0: cname }))
            : sp === 'news' ? tt('Nada novo por aqui. O Cosmo confere o Recompendium toda vez que abre.')
            : tt('Nenhum jogo instalado ainda.')}
        </div>
      )}
    </div>
  );
  return (
    <>
      <h2 className="wi-h"><Ic n={sp === 'cat' ? 'compass' : sp === 'news' ? 'bell' : sp === 'ach' ? 'medal' : sp === 'time' ? 'clock' : 'gear'} />{TITLE[sp]}</h2>
      {sp === 'cat' && <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="wi-search" placeholder={tt('Procure um jogo pelo nome…')} onDone={onSearchDone} />}
      {side ? (
        <div className="wi-split">
          {list}
          <div className="wi-side"><Side sp={sp} row={row} achList={achList} achLoading={achLoading} stats={stats} statsAll={statsAll} lib={lib} playMs={playMs} cname={cname} sndOn={sndOn} /></div>
        </div>
      ) : list}
    </>
  );
}

function Side({ sp, row, achList, achLoading, stats, statsAll, lib, playMs, cname, sndOn }: {
  sp: Sp; row: Row | undefined; achList: AchievementView[]; achLoading: boolean; stats: PlayStats | undefined; statsAll: Map<string, PlayStats | undefined>; lib: HubGame[]; playMs: number; cname: string; sndOn: boolean;
}) {
  if (!row) return null;
  if (sp === 'ach' && row.g) {
    if (!row.g.installed?.adapter) return <><h3>{row.g.title}</h3><p>{tt('O Cosmo ainda não sabe ler as conquistas deste port. Quando houver um leitor, elas aparecem aqui sozinhas.')}</p></>;
    const L = [...achList].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
    const got = L.filter(x => x.unlockedAt != null).length;
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="wi-big">{got}/{L.length}</div>
        <div className="wi-bar2"><i style={{ width: `${L.length ? (got / L.length) * 100 : 0}%` }} /></div>
        {achLoading && !L.length ? <p>{tt('Lendo…')}</p> : L.slice(0, 6).map(x => (
          <div key={x.id} className={`wi-a ${x.unlockedAt != null ? '' : 'lock'}`}>
            <span className="md">{x.icon ? <img src={x.icon} alt="" /> : <Ic n={x.unlockedAt != null ? 'star' : 'lock'} />}</span>
            <span className="t">{x.name}</span><span className="d">{x.unlockedAt != null ? fmtDate(x.unlockedAt) : tt('Bloqueada')}</span>
          </div>
        ))}
      </>
    );
  }
  if (sp === 'time') {
    if (!row.g) {
      const ses = lib.reduce((a, g) => a + (statsAll.get(g.key)?.sessions ?? 0), 0);
      const week = lib.reduce((a, g) => a + (statsAll.get(g.key)?.days.slice(7).reduce((p, q) => p + q, 0) ?? 0), 0) * 3600_000;
      return <><h3>{tt('Neste console')}</h3><div className="wi-big">{fmtPlay(playMs) || '0m'}</div><p>{tt('{0} em {1}', { 0: plural(ses, tt('sessão'), tt('sessões')), 1: plural(lib.length, tt('jogo'), tt('jogos')) })}<br />{tt('{0} nesta semana', { 0: fmtPlay(week) || '0m' })}</p></>;
    }
    const i = row.g.installed!, d = stats?.days ?? Array(14).fill(0), m = Math.max(...d, 0.01);
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="wi-big">{fmtPlay(i.playMs) || '0m'}</div>
        <p>{plural(stats?.sessions ?? 0, tt('sessão'), tt('sessões'))}{stats?.avgMs ? tt(' · média {0}', { 0: fmtPlay(stats.avgMs) || '<1m' }) : ''}{i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : ''}</p>
        <div className="wi-bars">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(4, (v / m) * 100) : 3}%` }} />)}</div>
        <p className="mut">{tt('últimos 14 dias')}</p>
      </>
    );
  }
  if (sp === 'cfg') {
    if (row.id === 'dir') return <><h3>{row.t}</h3><p>{tt('Onde o Cosmo instala o que você baixa. Jogos adicionados com “Escolher pasta” continuam onde estão.')}</p><div className="wi-path"><PortsDir /></div></>;
    if (row.id === 'snd') return <><h3>{row.t}</h3><p>{tt('Sons da interface: {0}. Confirme para {1}.', { 0: sndOn ? tt('ligados') : tt('desligados'), 1: sndOn ? tt('desligar') : tt('ligar') })}</p></>;
    if (row.id === 'radar') return <><h3>{row.t}</h3><p>{tt('O radar confere o catálogo do Recompendium toda vez que o Cosmo abre e avisa quando algo muda em {0}.', { 0: cname })}</p></>;
    return <><h3>{row.t}</h3><p>{tt('Desliga este console e volta para o palco do Cosmo.')}</p></>;
  }
  return null;
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
