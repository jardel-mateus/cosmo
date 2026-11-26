import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, RadarEvent } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch } from '../lib/search';
import { GameArt } from '../components/GameArt';
import { Discover, initialDiscover } from '../components/Discover';
import { GameView } from '../components/GameView';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { useFeed, useHubData, type HubGame } from './data';
import { wheelNav } from './wheel';
import { useGameMenu } from './menu';
import { semArquivos, tileClick } from '@shared/gameclick';
import { otherConsoles } from '../stage/consoles';
import { Obj, SHELLS, shellH, type Kind } from './shells';
import { tt } from '@shared/i18n';
import { gridStep } from '@shared/library';

type Tab = 'games' | 'disc' | 'news' | 'ach' | 'time' | 'cfg';
interface Cfg { kind: Kind; sfx: string; boot: 'retro' | 'soft' | 'white' }
interface St { tab: number; idx: number; li: number; game: string | null; achOpen: boolean; ai2: number }
type Hint = [Parameters<typeof Glyph>[0]['a'], string];
interface Row { key: string; g?: HubGame; t: string; v?: string; s?: string; id?: string; bar?: number; f?: RadarEvent }

export const RETRO: Record<string, Cfg> = {
  snes: { kind: 'snes', sfx: 'square', boot: 'retro' },
  n64: { kind: 'n64', sfx: 'tri', boot: 'retro' },
  ps1: { kind: 'mc1', sfx: 'deep', boot: 'soft' },
  gc: { kind: 'gc', sfx: 'bubble', boot: 'retro' },
  ps2: { kind: 'mc2', sfx: 'deep', boot: 'soft' },
  nes: { kind: 'nes', sfx: 'square', boot: 'retro' },
  megadrive: { kind: 'md', sfx: 'square', boot: 'retro' },
  nds: { kind: 'nds', sfx: 'click', boot: 'white' },
  gb: { kind: 'gb', sfx: 'square', boot: 'retro' },
  other: { kind: 'box', sfx: 'soft', boot: 'soft' },
};
const TABS: [Tab, string][] = [['games', tt('Meus jogos')], ['disc', tt('Descobrir')], ['news', tt('Novidades')], ['ach', tt('Conquistas')], ['time', tt('Tempo')], ['cfg', tt('Ajustes')]];
const FEED = { new: tt('Novo no catálogo'), upd: tt('Versão nova'), up: tt('Mudou de status') } as const;
const CFG_ROWS: Row[] = [{ key: 'dir', id: 'dir', t: tt('Pasta dos jogos') }, { key: 'snd', id: 'snd', t: tt('Sons') }, { key: 'radar', id: 'radar', t: tt('Radar de novidades') }, { key: 'off', id: 'off', t: tt('Voltar ao Cosmo') }];
const VISIBLE = 7, SEC_H = 72;

export function RetroHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const cfg = RETRO[id] ?? RETRO.snes!;
  const kind = cfg.kind;
  const cols = SHELLS[kind].cols, rh = shellH(kind) + (kind === 'mc2' ? 190 : 140);
  const self = isSelfInstall(id);
  const s = useSettings();
  const data = useHubData(id === 'other' ? otherConsoles(s.hidden) as ConsoleId[] : id);
  const trpc = useTRPC(), qc = useQueryClient();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>({ tab: tab === 'cat' ? 1 : 0, idx: 0, li: 0, game: null, achOpen: false, ai2: 0 });
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [dst, setDst] = useState(initialDiscover);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));

  useEffect(() => { setSfxProfile(cfg.sfx); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, [cfg.sfx]);

  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, tab: 1, game: null, achOpen: false })); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusSearch, 80); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const mine = data.lib;
  const split = data.recent < mine.length ? data.recent : 0;
  const lookup = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = mine.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ idx: i, tab: 0, game: mine[i]!.key }); }
    else if (lookup.has(game0)) { shown.current = true; up({ game: lookup.get(game0)!.key }); }
  }, [game0, mine.length, lookup.size]);
  useEffect(() => { if (st.idx >= mine.length && mine.length) up({ idx: mine.length - 1 }); }, [mine.length]);
  const g = mine[st.idx] ?? null;
  const tk = TABS[st.tab]![0];

  const byPlay = useMemo(() => [...data.lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [data.lib]);
  const maxPlay = Math.max(1, ...byPlay.map(x => x.installed?.playMs ?? 0));
  const rows: Row[] = tk === 'news' ? data.feed.map(f => ({ key: String(f.id), f, g: data.catalog.find(y => y.catalog?.id === f.gameId), t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''}`, v: ago(f.at) }))
    : tk === 'ach' ? data.lib.map(x => ({ key: x.key, g: x, t: x.title, v: x.installed?.achievements?.total ? `${x.installed.achievements.unlocked}/${x.installed.achievements.total}` : '—' }))
    : tk === 'time' ? byPlay.map(x => ({ key: x.key, g: x, t: x.title, v: fmtPlay(x.installed?.playMs ?? 0) || '0m', bar: (x.installed?.playMs ?? 0) / maxPlay }))
    : tk === 'cfg' ? CFG_ROWS.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? tt('Ligados') : tt('Desligados')) : '' }))
    : [];
  const row = rows[st.li];
  const feed = useFeed(data.feed, tk === 'news' && !st.game);
  const achGame = tk === 'ach' ? row?.g ?? null : null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];
  const statsAll = useQueries({ queries: (tk === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });

  const game = st.game ? lookup.get(st.game) ?? null : null;

  const menu = useGameMenu({
    show, onInfo: x => { sfx.play('ok'); up({ game: x.key }); }, onRemoved: () => up({ game: null }),
    onAch: x => up({ game: null, tab: 3, li: Math.max(0, data.lib.indexOf(x)), achOpen: true, ai2: 0 }),
  });
  useEffect(() => { if (menu.error) { show(menu.error); menu.reset(); } }, [menu.error]);
  const { options, run } = menu;
  const openGame = (x: HubGame) => { sfx.play('ok'); up({ game: x.key }); };

  const goTab = (d: number) => { sfx.play('move'); set(x => ({ ...x, tab: (x.tab + d + TABS.length) % TABS.length, li: 0, achOpen: false })); };
  const setTab = (i: number) => { if (i === st.tab) return; sfx.play('move'); up({ tab: i, li: 0, achOpen: false }); };

  const enter = () => {
    if (tk === 'games') {
      if (!g) { sfx.play('ok'); return up({ tab: 1 }); }
      if (semArquivos(g)) return openGame(g);
      return run(options(g)[0]!.k, g);
    }
    if (!row) return;
    if (tk === 'cfg') {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show(tt('O radar confere o catálogo toda vez que o Cosmo abre'));
    }
    if (tk === 'ach') { if (achList.length) { sfx.play('ok'); up({ achOpen: !st.achOpen, ai2: 0 }); } return; }
    if (row.f) feed.done(row.f);
    if (row.g) openGame(row.g);
  };
  const back = () => {
    sfx.play('back');
    if (st.achOpen) return up({ achOpen: false });
    if (st.tab !== 0) return up({ tab: 0 });
    onBack();
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    if (k === 'Enter') return enter();
    if (k === 'LB' || k === 'RB' || k === 'Tab') return goTab(k === 'LB' ? -1 : 1);
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (tk === 'games') {
      if (k === 'Y') { sfx.play('ok'); up({ tab: 1 }); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusSearch, 80); return; }
      if (!g) return;
      if (k === 'X') return openGame(g);
      const n = mine.length, i = st.idx;
      const to = R || L || U || D ? gridStep(i, n, cols, split, R ? 'R' : L ? 'L' : U ? 'U' : 'D') : null;
      if (typeof to === 'number') mv({ idx: to });
      else if (k === 'RT') mv({ idx: Math.min(n - 1, i + cols * 2) });
      else if (k === 'LT') mv({ idx: Math.max(0, i - cols * 2) });
      return;
    }
    if (tk === 'news' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && feed.drop(row?.f)) up({ li: Math.max(0, Math.min(st.li, rows.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (st.achOpen) { if (D && st.ai2 < achList.length - 1) mv({ ai2: st.ai2 + 1 }); else if (U && st.ai2 > 0) mv({ ai2: st.ai2 - 1 }); return; }
    if (D && st.li < rows.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 });
    else if (k === 'RT') mv({ li: Math.min(rows.length - 1, st.li + VISIBLE) }); else if (k === 'LT') mv({ li: Math.max(0, st.li - VISIBLE) });
  }, !(game || tk === 'disc'));

  const hints: Hint[] = tk === 'games'
    ? (g ? [['ok', !semArquivos(g) ? options(g)[0]!.l : tt('Página do jogo')], ['x', tt('Página do jogo')], ['y', tt('Buscar')], ['rb', tt('Seção')], ['back', tt('Sair')]] : [['ok', tt('Descobrir jogos')], ['rb', tt('Seção')], ['back', tt('Sair')]])
    : tk === 'news' && rows.length ? [['ok', tt('Ver jogo')], ['x', tt('Dispensar')], ['y', tt('Limpar tudo')], ['rb', tt('Seção')], ['back', tt('Voltar')]]
    : [['ok', tk === 'cfg' ? 'OK' : tk === 'ach' ? (st.achOpen ? tt('Fechar') : tt('Ver lista')) : tt('Abrir')], ['ud', tt('Mover')], ['rb', tt('Seção')], ['back', tt('Voltar')]];
  const H = <div className="rh-ft">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;
  const off = Math.max(0, Math.min(st.li - 3, rows.length - VISIBLE));
  const line = (x: HubGame) => id === 'other' ? `${sourceOf(x)} · ${line0(x)}` : line0(x);
  const line0 = (x: HubGame) => x.installed?.missing ? (x.installed?.uninstalled ? tt('Não instalado') : tt('Pasta não encontrada')) : x.installed?.running ? tt('Jogando agora') : x.installed?.playMs ? tt('{0} jogadas', { 0: fmtPlay(x.installed.playMs) }) : tt('Ainda não jogado');

  const header = (
    <header className="rh-hd">
      <b className="rh-name">{c.name}</b>
      <nav className="rh-tabs">
        <Glyph a="lb" />
        {TABS.map(([k, l], j) => (
          <button key={k} className={`${j === st.tab ? 'on' : ''}`} onClick={() => setTab(j)}>
            {l}{k === 'news' && data.feed.length > 0 && <i className="nw">{data.feed.length}</i>}
          </button>
        ))}
        <Glyph a="rb" />
      </nav>
      <span className="rh-clock">{clock}</span>
    </header>
  );

  const item = (x: HubGame, i: number) => (
    <button key={x.key} className={`rg-it ${i === st.idx ? 'on' : ''} ${x.installed?.missing ? 'miss' : ''} ${x.installed?.running ? 'run' : ''}`} aria-label={x.title}
      onClick={e => tileClick(e, x, { select: () => { if (i !== st.idx) { sfx.play('move'); up({ idx: i }); } }, page: () => openGame(x), play: () => run('play', x) })}>
      <Obj kind={kind}><GameArt title={x.title} console={x.console} platformName={x.platformName} fallback={x.coverUrl} variant="cover" done={!!x.installed?.achievements?.complete} /></Obj>
      <span className="rg-t">{x.title}</span>
      <span className="rg-s">{line(x)}</span>
    </button>
  );
  // Jogados recentemente numa grade própria no alto; a coleção vem embaixo, com um título para cada parte.
  const yOf = (i: number) => !split ? Math.floor(i / cols) * rh
    : i < split ? SEC_H + Math.floor(i / cols) * rh
    : SEC_H * 2 + Math.ceil(split / cols) * rh + Math.floor((i - split) / cols) * rh;
  const viewH = kind === 'nds' ? 790 : 796;
  // Desce o bastante para ver o jogo escolhido inteiro; na primeira fileira de uma parte, mostra também o título dela.
  const first = !!split && (st.idx < split ? st.idx < cols : st.idx - split < cols);
  const shift = Math.min(Math.max(0, yOf(st.idx) + rh - viewH + 40), Math.max(0, yOf(st.idx) - (first ? SEC_H : 0)));
  const gridOf = (a: number, b: number) => (
    <div className="rg-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: rh }}>{mine.slice(a, b).map((x, j) => item(x, a + j))}</div>
  );
  const games = (
    <div className="rg-view" onWheel={wheelNav('v')}><div className="rg-stack" style={{ transform: `translateY(-${shift}px)` }}>
      {split ? <>
        <h3 className="rg-sec" style={{ height: SEC_H }}>{tt('Jogados recentemente')}</h3>{gridOf(0, split)}
        <h3 className="rg-sec" style={{ height: SEC_H }}>{tt('Coleção')}<small>{plural(mine.length - split, tt('jogo'), tt('jogos'))}</small></h3>{gridOf(split, mine.length)}
      </> : gridOf(0, mine.length)}
    </div></div>
  );

  const empty = (
    <div className="rw rg-empty">
      <b>{tt('Nenhum jogo de {0} instalado ainda', { 0: c.name })}</b>
      <p>{data.catalog.length ? tt('O catálogo tem {0} para este console. Procure um em Descobrir.', { 0: plural(data.catalog.length, tt('jogo'), tt('jogos')) }) : tt('O radar avisa quando aparecer o primeiro recomp de {0}.', { 0: c.name })}</p>
      {data.catalog.length > 0 && <button className="on" onClick={() => { sfx.play('ok'); up({ tab: 1 }); }}><Glyph a="ok" />{tt('Descobrir jogos')}</button>}
    </div>
  );

  return (
    <section className={`view hub sk-rt t-${id}`} style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`rt k-${kind}`} style={{ ['--cc' as string]: c.color }}>
        {header}

        {tk === 'games' && (kind === 'nds' ? (
          <>
            <div className="ds-top">
              {g ? <DsTop g={g} line={line(g)} /> : empty}
            </div>
            <div className="ds-hinge" />
            <div className="ds-bot">
              {games}
            </div>
          </>
        ) : mine.length ? (
          games
        ) : empty)}

        {tk !== 'games' && tk !== 'disc' && (
          <div className="rw rl">
            {tk === 'time' && <div className="rl-sum">{tt('{0} neste console · {1} sessões', { 0: fmtPlay(data.playMs) || '0m', 1: statsAll.reduce((a, q) => a + (q.data?.sessions ?? 0), 0) })}</div>}
            {st.achOpen && achGame ? (
              <>
                <div className="rl-sum">{achGame.title} · {achList.filter(a => a.unlockedAt != null).length}/{achList.length}</div>
                <AchList list={achList} sel={st.ai2} />
              </>
            ) : rows.length ? (
              <div className="rl-rows">{rows.slice(off, off + VISIBLE).map((r, j) => (
                <button key={r.key} className={`rl-r ${off + j === st.li ? 'on' : ''} ${r.g ? 'thumb' : ''}`} onClick={() => { if (st.li === off + j) enter(); else { sfx.play('move'); up({ li: off + j }); } }}>
                  {r.g && <span className="th"><GameArt title={r.g.title} console={r.g.console} platformName={r.g.platformName} fallback={r.g.coverUrl} variant="cover" /></span>}
                  <span className="t">{r.t}</span>{r.v && <span className="v">{r.v}</span>}
                  {r.s && <span className="s">{r.s}</span>}
                  {r.bar != null && <span className="bar"><i style={{ width: `${r.bar * 100}%` }} /></span>}
                </button>
              ))}</div>
            ) : <div className="rl-empty">{tk === 'news' ? tt('Nada novo por aqui.') : tt('Nenhum jogo instalado.')}</div>}
            {tk === 'cfg' && row && <div className="rl-note">{row.id === 'dir' ? <PortsDir /> : row.id === 'snd' ? tt('Sons de navegação da interface.') : row.id === 'radar' ? tt('Confere o catálogo toda vez que o Cosmo abre.') : tt('Desliga este console e volta ao palco.')}</div>}
            {tk === 'ach' && !st.achOpen && achGame && !achGame.installed?.adapter && <div className="rl-note">{tt('O Cosmo ainda não lê as conquistas deste port.')}</div>}
          </div>
        )}

        {tk !== 'disc' && H}

        {tk === 'disc' && !game && header}
        {tk === 'disc' && !game && (
          <Discover theme="d-retro" shape={kind === 'snes' || kind === 'n64' ? 'wide' : kind === 'mc1' || kind === 'gb' || kind === 'nds' ? 'square' : 'tall'} cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info')} run={run} onOpen={openGame} onBack={() => { sfx.play('back'); up({ tab: 0 }); }} onTab={goTab}
            {...(id === 'other' ? { groupOf: sourceOf, groupLabel: tt('Plataforma') } : {})} />
        )}
        {game && <GameView theme="d-retro" g={game} opts={options(game, true)} run={run} self={self} onBack={() => up({ game: null })} />}
        {toast}
      </Fit>
      <BootOverlay kind={cfg.boot} label={c.short} />
    </section>
  );
}

function DsTop({ g, line }: { g: HubGame; line: string }) {
  return (
    <div className="ds-sel" key={g.key}>
      <span className="ds-cv"><GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant="cover" /></span>
      <div>
        <h2>{g.title}</h2>
        <p>{[g.catalog?.developer, g.catalog?.year].filter(Boolean).join(' · ')}</p>
        <p className="hi">{line}</p>
        {g.installed?.achievements?.total ? <p>{tt('{0}/{1} conquistas', { 0: g.installed.achievements.unlocked, 1: g.installed.achievements.total })}</p> : null}
      </div>
    </div>
  );
}

function AchList({ list, sel }: { list: AchievementView[]; sel: number }) {
  const off = Math.max(0, Math.min(sel - 2, list.length - 6));
  return (
    <div className="rl-rows">{list.slice(off, off + 6).map((a, j) => (
      <div key={a.id} className={`rl-r ach ${off + j === sel ? 'on' : ''} ${a.unlockedAt != null ? '' : 'lock'}`}>
        <span className="t">{a.unlockedAt != null ? '★ ' : '· '}{a.name}</span><span className="v">{a.unlockedAt != null ? fmtDate(a.unlockedAt).split(',')[0] : tt('Bloqueada')}</span>
        {a.description && <span className="s">{a.description}</span>}
      </div>
    ))}</div>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}

const sourceOf = (g: HubGame) => (g.console === 'other' ? g.platformName ?? tt('Outros') : CONSOLE_NAME[g.console]);
