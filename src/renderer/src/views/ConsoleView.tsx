import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame, ConsoleId, InstalledGame } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Hints } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { askConfirm } from '../lib/dialogs';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { sfx } from '../lib/sfx';
import { useAskDeletePrefix } from '../lib/wine';
import { GameArt } from '../components/GameArt';
import { CONSOLES, otherConsoles } from '../stage/consoles';
import { useSettings } from '../lib/settings';
import { matchesQuery } from '../lib/search';
import { SearchBox } from '../components/SearchBox';
import { CatalogPage, GamePage } from './GamePages';
import { tt } from '@shared/i18n';

type Tab = 'lib' | 'cat';
export interface Props { id: ConsoleId; game?: string; tab?: Tab; active: boolean; onBack: () => void }

export function ConsoleView({ id, game, tab: tab0, active, onBack }: Props) {
  const c = CONSOLES.find(x => x.id === id)!;
  const trpc = useTRPC(), qc = useQueryClient();
  const games = useQuery(trpc.games.list.queryOptions());
  const s = useSettings();
  const group = id === 'other' ? otherConsoles(s.hidden) : [id];
  const mine = (games.data ?? []).filter(g => group.includes(g.console));
  const isOther = id === 'other';
  const [only, setOnly] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState<Tab>(tab0 ?? 'lib');
  type Open = { kind: 'game'; id: string } | { kind: 'ach'; id: string } | { kind: 'cat'; game: CatalogGame };
  const [open, setOpen] = useState<Open | null>(game ? { kind: 'game', id: game } : null);
  const installedBy = new Map((games.data ?? []).filter(g => g.catalogId).map(g => [g.catalogId!, g.id]));
  const [q, setQ] = useState('');
  const cat = useQuery(trpc.catalog.list.queryOptions(id === 'other' ? { consoles: group } : { console: id }));
  const catShown = (cat.data ?? []).filter(g => matchesQuery(q, g.title, g.platformName, g.developer, g.repo));
  const mineShown = mine.filter(g => matchesQuery(q, g.title, g.platformName));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); if (g) setOpen({ kind: 'game', id: g.id }); } }));

  useEffect(() => { if (!tab0 && games.data && !mine.length) setTab('cat'); }, [games.data]);

  const root = useRef<HTMLDivElement>(null);
  const nav = useSpatialNav(root, {
    active: active && !open,
    onFocus: el => {
      if (!isOther || !el) return;
      const side = el.closest('.oth-side');
      setWide(!side && !!el.closest('.oth-main'));
      if (side && el.dataset.src !== undefined) setOnly(el.dataset.src || null);
    },
    onKey: k => {
      if (k === 'Escape') { sfx.play('back'); onBack(); return true; }
      if (k === 'ArrowLeft' && isOther) {
        const el = root.current?.querySelector<HTMLElement>('.oth-main [data-on]');
        const cards = [...(root.current?.querySelectorAll<HTMLElement>('.oth-main [data-hf]') ?? [])];
        const back = root.current?.querySelector<HTMLElement>('.oth-side button.on');
        if (el && back && el.getBoundingClientRect().left <= Math.min(...cards.map(c => c.getBoundingClientRect().left)) + 4) { sfx.play('move'); nav.focusEl(back); return true; }
      }
      if (k === 'LB' || k === 'RB' || k === 'Tab') { sfx.play('move'); setTab(t => (t === 'lib' ? 'cat' : 'lib')); nav.reset(); return true; }
    },
  });

  return (
    <section className="view chub" style={{ ['--cc' as string]: c.color }} aria-label={c.name}>
      {open?.kind === 'ach' ? <Achievements id={open.id} active={active} onBack={() => { sfx.play('back'); setOpen({ kind: 'game', id: open.id }); }} />
        : open?.kind === 'game' ? <GamePage key={open.id} id={open.id} active={active} onBack={() => setOpen(null)} onAchievements={() => setOpen({ kind: 'ach', id: open.id })} />
        : open?.kind === 'cat' ? <CatalogPage game={open.game} installedId={installedBy.get(open.game.id) ?? null} active={active} onBack={() => setOpen(null)} onOpenInstalled={gid => setOpen({ kind: 'game', id: gid })} />
        : (
        <div ref={root} style={{ display: 'contents' }}>
          <header className="chub-top">
            <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>{tt('◀ COSMO')}</button>
            <h1 className="glow">{c.name.toUpperCase()}</h1>
            <nav className="seg">
              <button className={tab === 'lib' ? 'on' : ''} data-hf onClick={() => setTab('lib')}>{tt('MEUS JOGOS')}{' '}{mine.length > 0 && <span className="n">{mine.length}</span>}</button>
              <button className={tab === 'cat' ? 'on' : ''} data-hf onClick={() => setTab('cat')}>{tt('DESCOBRIR')}</button>
            </nav>
            <SearchBox value={q} onChange={setQ} className="search chub-search" placeholder={tab === 'lib' ? tt('Buscar nos seus jogos…  ( / )') : tt('Buscar entre {0}…  ( / )', { 0: plural(cat.data?.length ?? 0, tt('recomp'), tt('recomps')) })}
              onDone={() => { const first = root.current?.querySelector<HTMLElement>('.grid [data-hf], .rows [data-hf]'); if (first) nav.focusEl(first); }} />
            <span className="grow" />
            <button className="btn acc" data-hf disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending ? tt('Lendo a pasta…') : tt('+ Adicionar jogo')}</button>
          </header>
          {!isOther && <p className="chub-note">{tt('Versão provisória do hub. A interface no estilo do {0} chega numa próxima etapa.', { 0: c.name })}</p>}
          {add.error && <p className="err">{add.error.message}</p>}
          {add.data && !add.data.adapter && <p className="warn">{tt('Adicionei')}{' '}<b>{add.data.title}</b>{tt(', mas ainda não sei ler as conquistas dele.')}</p>}

          {isOther ? (
            <div className={`chub-body oth ${wide ? 'wide' : ''}`}>
              {tab === 'lib'
                ? <OtherBrowser items={mineShown} only={only} setOnly={setOnly} cls="rows" empty={q ? <p className="pad24 dim">{tt('Nada encontrado.')}</p> : <EmptyLib />}
                    render={g => <GameRow key={g.id} g={g} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'game', id: g.id }); }} />} />
                : <OtherBrowser items={catShown} only={only} setOnly={setOnly} cls="grid"
                    empty={<p className="pad24 dim">{q ? tt('Nada encontrado.') : tt('Nenhum recomp por aqui ainda.')}</p>}
                    render={g => <GameCard key={g.id} g={g} installed={installedBy.has(g.id)} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'cat', game: g }); }} />} />}
            </div>
          ) : (
            <div className="chub-body">
              {tab === 'lib' ? (
                mine.length ? mineShown.length ? <div className="rows">{mineShown.map(g => <GameRow key={g.id} g={g} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'game', id: g.id }); }} />)}</div> : <p className="pad24 dim">{tt('Nada encontrado.')}</p>
                  : <EmptyLib />
              ) : (
                <>
                  {catShown.length === 0 && <p className="pad24 dim">{q ? tt('Nada encontrado.') : tt('Ainda não há recomps deste console no catálogo.')}</p>}
                  <div className="grid">{catShown.map(g => <GameCard key={g.id} g={g} installed={installedBy.has(g.id)} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'cat', game: g }); }} />)}</div>
                  <p className="credit">{tt('Catálogo:')}{' '}<a href="https://recompendium.com/" target="_blank" rel="noreferrer">{tt('Recompendium')}</a></p>
                </>
              )}
            </div>
          )}
          <Hints items={[['ud', tt('Navegar')], ['ok', tt('Abrir')], ['lb', tt('Aba')], ['back', tt('Cosmo')]]} />
        </div>
      )}
    </section>
  );
}

const sourceOf = (g: { console: ConsoleId; platformName: string | null }) => g.platformName ?? (g.console === 'other' ? tt('Outros') : CONSOLE_NAME[g.console]);

const SHORT: [RegExp, string][] = [
  [/super famicom|snes/i, 'SNES'], [/gamecube/i, 'GC'], [/game ?boy advance/i, 'GBA'], [/game ?boy color/i, 'GBC'], [/game ?boy/i, 'GB'],
  [/\bnes\b|famicom/i, 'NES'], [/nintendo 64/i, 'N64'], [/arcade/i, 'ARC'], [/mega-?cd|sega cd/i, 'MCD'], [/mega drive|genesis/i, 'MD'],
  [/32x/i, '32X'], [/3ds/i, '3DS'], [/nintendo ds/i, 'DS'], [/wii ?u/i, 'WIIU'], [/wii/i, 'WII'], [/switch 2/i, 'NS2'], [/switch/i, 'NSW'],
  [/mac/i, 'MAC'], [/mobile/i, 'MOB'], [/dreamcast/i, 'DC'], [/vita/i, 'VITA'], [/neo ?geo/i, 'NEO'], [/virtual boy/i, 'VB'],
  [/game gear/i, 'GG'], [/xbox one/i, 'XB1'], [/xbox 360/i, '360'], [/^xbox$/i, 'XBOX'], [/turbografx|pc engine/i, 'PCE'],
  [/master system/i, 'SMS'], [/saturn/i, 'SAT'], [/playstation (\d)/i, 'PS$1'], [/^playstation$/i, 'PS1'], [/psp/i, 'PSP'],
];
const shortOf = (name: string, console: ConsoleId) => {
  for (const [re, sh] of SHORT) { const m = name.match(re); if (m) return sh.replace('$1', m[1] ?? ''); }
  const c = CONSOLES.find(x => x.id === console && x.id !== 'other');
  return c?.short ?? name.split(/[\s/]+/).filter(Boolean).slice(0, 3).map(w => w[0]!.toUpperCase()).join('');
};

function OtherBrowser<T extends { console: ConsoleId; platformName: string | null }>({ items, only, setOnly, cls, render, empty }: {
  items: T[]; only: string | null; setOnly: (s: string | null) => void; cls: string; render: (g: T) => ReactNode; empty: ReactNode;
}) {
  const groups = new Map<string, T[]>();
  for (const g of items) { const k = sourceOf(g); groups.set(k, [...(groups.get(k) ?? []), g]); }
  const list = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const sel = only && groups.has(only) ? only : null;
  const color = (g: T | undefined) => (g ? CONSOLES.find(c => c.id === g.console && c.id !== 'other')?.color : undefined);
  const shown = sel ? list.filter(([k]) => k === sel) : list;
  return (
    <>
      <nav className="oth-side" aria-label={tt('Console de origem')}>
        <button data-hf data-src="" className={!sel ? 'on' : ''} onClick={() => setOnly(null)}>
          <span className="sh">{tt('TUDO')}</span><span className="nm">{tt('Todos')}</span><span className="ct">{items.length}</span>
        </button>
        {list.map(([k, gs]) => (
          <button key={k} data-hf data-src={k} title={k} className={sel === k ? 'on' : ''} style={{ ['--sc' as string]: color(gs[0]) }} onClick={() => setOnly(k)}>
            <span className="sh">{shortOf(k, gs[0]!.console)}</span><span className="nm">{k}</span><span className="ct">{gs.length}</span>
          </button>
        ))}
      </nav>
      <div className="oth-main">
        {!items.length ? empty : shown.map(([k, gs]) => (
          <section key={k} style={{ ['--sc' as string]: color(gs[0]) }}>
            <h2 className="oth-head">{k}<small>{plural(gs.length, tt('jogo'), tt('jogos'))}</small></h2>
            <div className={cls}>{gs.map(render)}</div>
          </section>
        ))}
        {cls === 'grid' && <p className="credit">{tt('Catálogo:')}{' '}<a href="https://recompendium.com/" target="_blank" rel="noreferrer">{tt('Recompendium')}</a></p>}
      </div>
    </>
  );
}

function EmptyLib() {
  const trpc = useTRPC();
  const supported = useQuery(trpc.achievements.supported.queryOptions());
  return (
    <div className="empty-box">
      <p>{tt('Nenhum jogo deste console na sua biblioteca. Use “Adicionar jogo” e aponte a pasta onde o recomp está instalado.')}</p>
      <p style={{ marginTop: 10 }}>{tt('Conquistas já funcionam com:')}</p>
      <ul>{supported.data?.map(s => <li key={s.id}>{s.label}</li>)}</ul>
    </div>
  );
}

function GameCard({ g, installed, onOpen }: { g: CatalogGame; installed: boolean; onOpen: () => void }) {
  return (
    <button className="lcard" data-hf onClick={onOpen}>
      <div style={{ position: 'relative' }}>
        <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} />
        <span className={`st st-${g.status}`}>{STATUS_LABEL[g.status]}</span>
        {installed && <span className="inlib">{tt('NA BIBLIOTECA')}</span>}
        {g.noLink && !isSelfInstall(g.console) && <span className="nolink" title={tt('O Recompendium lista este projeto, mas prefere não pôr link para ele')}>{tt('SEM LINK')}</span>}
      </div>
      <div className="lmeta">
        <div className="title">{g.title}</div>
        <div className="dim">{['other', 'gb', 'megadrive'].includes(g.console) ? g.platformName : g.developer ?? ''}{g.year ? ` · ${g.year}` : ''}</div>
        {g.repo && <span className="repo">{g.repo}</span>}
      </div>
    </button>
  );
}

function GameRow({ g, onOpen }: { g: InstalledGame; onOpen: () => void }) {
  const a = g.achievements;
  const pct = a && a.total ? Math.round((a.unlocked / a.total) * 100) : 0;
  return (
    <button className="lrow" data-hf onClick={onOpen}>
      <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} className="thumb" />
      <div className="row-main">
        <div className="title">{g.title}</div>
        <div className="dim">{g.running ? tt('jogando agora · ') : ''}{g.playMs ? tt('{0} jogadas', { 0: fmtPlay(g.playMs) }) : tt('ainda não jogado')}{g.lastPlayed ? ` · ${ago(g.lastPlayed)}` : ''}{g.version ? ` · ${g.version}` : ''} · {g.installDir}</div>
      </div>
      {a && a.total > 0 && (
        <div className="prog">
          <div className="prog-n">{a.unlocked}/{a.total}</div>
          <div className="pbar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      )}
    </button>
  );
}

function Achievements({ id, active, onBack }: { id: string; active: boolean; onBack: () => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const data = useQuery(trpc.achievements.forGame.queryOptions({ id }));
  const resync = useMutation(trpc.achievements.resync.mutationOptions({
    onSuccess: d => { qc.setQueryData(trpc.achievements.forGame.queryKey({ id }), d); void qc.invalidateQueries({ queryKey: trpc.games.list.queryKey() }); },
  }));
  const remove = useMutation(trpc.games.remove.mutationOptions({ onSuccess: () => { void qc.invalidateQueries(); onBack(); } }));
  const askPrefix = useAskDeletePrefix();
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, onKey: k => { if (k === 'Escape') { onBack(); return true; } } });

  if (!data.data) return <p className="dim pad24">{data.error ? data.error.message : tt('Carregando…')}</p>;
  const d = data.data;
  const got = d.list.filter(a => a.unlockedAt != null);
  const pts = d.list.reduce((s, a) => s + (a.points ?? 0), 0), gotPts = got.reduce((s, a) => s + (a.points ?? 0), 0);
  const shown = d.list.filter(a => filter === 'all' || (filter === 'on') === (a.unlockedAt != null)).sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));

  return (
    <div ref={root} style={{ display: 'contents' }}>
      <header className="chub-top">
        <button className="back" data-hf onClick={onBack}>{tt('◀ VOLTAR')}</button>
        <h1 className="glow" style={{ fontSize: 18 }}>{d.game.title}</h1>
        <span className="grow" />
        <button className="btn" data-hf disabled={resync.isPending} onClick={() => resync.mutate({ id })}>{resync.isPending ? tt('Lendo…') : tt('Ler de novo')}</button>
        <button className="btn ghost" data-hf onClick={() => openFolder.mutate({ id })}>{tt('Abrir pasta')}</button>
        <button className="btn ghost danger" data-hf onClick={() => { void askConfirm({ title: tt('Remover {0} do Cosmo? Os arquivos do jogo não são apagados.', { 0: d.game.title }), ok: tt('Remover'), danger: true }).then(async y => { if (y) remove.mutate({ id, deletePrefix: await askPrefix(id, d.game.title) }); }); }}>{tt('Remover')}</button>
      </header>
      <div className="chub-body">
        <div className="ach-head">
          <div className="achbig">{got.length}<span>/{d.list.length}</span></div>
          <div className="pbar wide"><i style={{ width: `${d.list.length ? (got.length / d.list.length) * 100 : 0}%` }} /></div>
          {pts > 0 && <div className="dim">{gotPts}/{pts} G</div>}
          <div className="seg small">
            {(['all', 'on', 'off'] as const).map(f => <button key={f} data-hf className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? tt('Todas') : f === 'on' ? tt('Desbloqueadas') : tt('Bloqueadas')}</button>)}
          </div>
        </div>
        {d.errors.map(e => <p key={e} className="err">{e}</p>)}
        {!d.game.adapter && <p className="warn" style={{ margin: '0 28px' }}>{tt('O Cosmo ainda não sabe ler as conquistas deste jogo.')}</p>}
        <div className="ach-list">
          {shown.map(a => (
            <div key={a.id} className={`ach-item ${a.unlockedAt != null ? 'got' : 'locked'}`}>
              <Icon src={a.icon} />
              <div className="ach-main"><div className="title">{a.name}</div><div className="dim">{a.description}</div></div>
              <div className="ach-side">
                {a.points != null && <div className="pts">{a.points} G</div>}
                <div className="dim">{a.unlockedAt != null ? fmtDate(a.unlockedAt) : tt('Bloqueada')}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="credit">{tt('Lista: {0}', { 0: d.origin ?? '—' })}<br />{tt('Desbloqueios lidos de: {0}', { 0: d.unlockFile ?? '—' })}</p>
      </div>
      <Hints items={[['ok', tt('Escolher')], ['back', tt('Voltar')]]} />
    </div>
  );
}

function Icon({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return <div className="achico">{src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <span>★</span>}</div>;
}
