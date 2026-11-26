import { useEffect, useMemo, useRef, type ReactNode, type WheelEvent } from 'react';
import { STATUS_LABEL, SELF_INSTALL_NOTE } from '@shared/consoles';
import { Glyph, useKeys, type Key } from '../lib/input';
import { sfx } from '../lib/sfx';
import { fmtPlay, plural } from '../lib/format';
import { matchesQuery, similarity } from '../lib/search';
import { useTranslated } from '../lib/translate';
import { useInfo } from '../lib/art';
import { GameArt } from './GameArt';
import { SearchBox } from './SearchBox';
import type { HubGame } from '../hubs/data';
import { tt } from '@shared/i18n';

export type DFilter = 'top' | 'all' | 'new' | 'play' | 'wip' | 'inst';
export type DSort = 'pop' | 'az' | 'year' | 'recent';
export interface DState { q: string; filter: DFilter; sort: DSort; zone: 'search' | 'chips' | 'groups' | 'body'; row: number; col: number; chip: number; menu: boolean; mi: number; grp: string | null }
export const initialDiscover = (): DState => ({ q: '', filter: 'top', sort: 'pop', zone: 'body', row: 0, col: 0, chip: 0, menu: false, mi: 0, grp: null });
export interface DOpt { k: string; l: string; icon?: ReactNode }

const FILTERS: [DFilter, string][] = [['top', tt('Destaques')], ['all', tt('Todos')], ['new', tt('Novos')], ['play', tt('Jogáveis')], ['wip', tt('Em progresso')], ['inst', tt('Instalados')]];
const SORTS: [DSort, string][] = [['pop', tt('Populares')], ['az', 'A–Z'], ['year', tt('Ano')], ['recent', tt('Recentes')]];
const GAP = 26;
const SHAPES = { tall: { COLS: 5, CARD_W: 220, ROW_H: 430, GRID_ROW: 400 }, wide: { COLS: 4, CARD_W: 290, ROW_H: 340, GRID_ROW: 310 }, square: { COLS: 5, CARD_W: 220, ROW_H: 330, GRID_ROW: 300 } };

interface Row { key: string; title: string; items: HubGame[] }

function sorter(s: DSort) {
  return (a: HubGame, b: HubGame) => {
    const ca = a.catalog, cb = b.catalog;
    if (s === 'az') return a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' });
    if (s === 'year') return (cb?.year ?? 0) - (ca?.year ?? 0) || a.title.localeCompare(b.title);
    if (s === 'recent') return (cb?.firstSeenAt ?? 0) - (ca?.firstSeenAt ?? 0);
    return (cb?.stars ?? 0) - (ca?.stars ?? 0) || a.title.localeCompare(b.title);
  };
}

export function Discover({ theme, cname, games: all, extra: allExtra = [], self, st, set, options, run, onOpen, onBack, hints, shape = 'tall', onTab, groupOf, groupLabel = tt('Plataforma'), allLabel = tt('Todas'), title = tt('Descobrir'), place, active = true, onSection, onTopEdge }: {
  theme: string; cname: string; games: HubGame[]; extra?: HubGame[]; self: boolean;
  st: DState; set: (f: (s: DState) => DState) => void;
  options: (g: HubGame) => DOpt[]; run: (k: string, g: HubGame) => void; onOpen: (g: HubGame) => void; onBack: () => void;
  hints?: boolean; shape?: 'tall' | 'wide' | 'square'; onTab?: (d: 1 | -1) => void;
  groupOf?: (g: HubGame) => string; groupLabel?: string; allLabel?: string; title?: string; place?: string; active?: boolean; onSection?: (d: 1 | -1) => void; onTopEdge?: () => void;
}) {
  const groups = useMemo(() => {
    if (!groupOf) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const g of [...all, ...allExtra]) { const k = groupOf(g); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt'));
  }, [all, allExtra, groupOf]);
  const hasGroups = groups.length > 1;
  const grp = hasGroups && st.grp && groups.some(x => x[0] === st.grp) ? st.grp : null;
  const games = useMemo(() => (grp && groupOf ? all.filter(g => groupOf(g) === grp) : all), [all, grp, groupOf]);
  const extra = useMemo(() => (grp && groupOf ? allExtra.filter(g => groupOf(g) === grp) : allExtra), [allExtra, grp, groupOf]);
  const grpRef = useRef<HTMLDivElement>(null);
  useEffect(() => { grpRef.current?.querySelector('.cur')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [grp]);
  const { COLS, CARD_W, ROW_H, GRID_ROW } = SHAPES[shape];
  const up = (p: Partial<DState>) => set(s => ({ ...s, ...p }));
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const q = st.q.trim();

  const { rows, grid, suggest } = useMemo(() => {
    const base = q ? [...games, ...extra] : games;
    if (q) {
      const hit = base.filter(g => matchesQuery(q, g.title, g.platformName, g.catalog?.developer, g.catalog?.year ? String(g.catalog.year) : null)).sort(sorter(st.sort));
      const sug = hit.length ? [] : [...base].map(g => [g, similarity(q, g.title)] as const).filter(x => x[1] > 0.2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
      return { rows: [] as Row[], grid: hit, suggest: sug };
    }
    if (st.filter === 'top') {
      const by = sorter('pop');
      const R: Row[] = [
        { key: 'new', title: tt('Novos no catálogo'), items: games.filter(g => g.isNew).sort(sorter('recent')) },
        { key: 'pop', title: tt('Mais populares'), items: [...games].sort(by).slice(0, 20) },
        { key: 'full', title: tt('Totalmente jogáveis'), items: games.filter(g => g.status === 'full').sort(by) },
        { key: 'play', title: tt('Jogáveis'), items: games.filter(g => g.status === 'play').sort(by) },
        { key: 'wip', title: tt('Em progresso'), items: games.filter(g => g.status === 'wip').sort(by) },
      ];
      const dec = new Map<number, HubGame[]>();
      for (const g of games) { const y = g.catalog?.year; if (y) { const d = Math.floor(y / 10) * 10; dec.set(d, [...(dec.get(d) ?? []), g]); } }
      for (const [d, L] of [...dec].sort((a, b) => a[0] - b[0])) if (L.length >= 2) R.push({ key: `d${d}`, title: tt('Lançados nos anos {0}', { 0: String(d).slice(2) }), items: L.sort(by) });
      const out = R.filter(r => r.items.length);
      return { rows: out.length > 1 ? out : [], grid: out.length > 1 ? [] : [...games].sort(by), suggest: [] };
    }
    const f = st.filter;
    const L = games.filter(g => f === 'all' || (f === 'new' && g.isNew) || (f === 'play' && (g.status === 'full' || g.status === 'play')) || (f === 'wip' && g.status === 'wip') || (f === 'inst' && !!g.installed));
    return { rows: [], grid: L.sort(sorter(st.sort)), suggest: [] };
  }, [games, extra, q, st.filter, st.sort]);

  const shelves = rows.length > 0;
  const list = shelves ? rows[Math.min(st.row, rows.length - 1)]?.items ?? [] : grid.length ? grid : suggest;
  const gridMode = !shelves;
  const idx = gridMode ? st.row * COLS + st.col : st.col;
  const g: HubGame | null = shelves ? list[Math.min(st.col, list.length - 1)] ?? null : list[Math.min(idx, list.length - 1)] ?? null;
  const total = shelves ? rows.reduce((a, r) => a + r.items.length, 0) : list.length;

  useEffect(() => {
    if (shelves && st.row >= rows.length) up({ row: 0, col: 0 });
    if (!shelves && idx >= list.length && list.length) up({ row: Math.floor((list.length - 1) / COLS), col: (list.length - 1) % COLS });
  }, [rows.length, list.length]);

  const chips = [...FILTERS.map(f => f[0]), 'sort'] as const;
  const opts = g ? options(g) : [];
  const mv = (p: Partial<DState>) => { sfx.play('move'); up(p); };
  // Rodinha do mouse: anda uma fileira por vez (na prateleira, para os lados com Shift ou trackpad).
  const wheelAt = useRef(0);
  const onWheel = (e: WheelEvent) => {
    if (!total || st.menu) return;
    const vert = Math.abs(e.deltaY) >= Math.abs(e.deltaX) && !e.shiftKey;
    const d = Math.sign(vert ? e.deltaY : e.deltaX || e.deltaY);
    const now = performance.now();
    if (!d || now - wheelAt.current < 70) return;
    wheelAt.current = now;
    if (shelves) {
      const row = Math.min(st.row, rows.length - 1);
      if (vert) { const r = Math.max(0, Math.min(rows.length - 1, row + d)); if (r !== row || st.zone !== 'body') mv({ zone: 'body', row: r, col: Math.min(st.col, rows[r]!.items.length - 1) }); }
      else { const c = Math.max(0, Math.min(list.length - 1, st.col + d)); if (c !== st.col || st.zone !== 'body') mv({ zone: 'body', col: c }); }
      return;
    }
    const last = Math.floor((list.length - 1) / COLS), r = Math.max(0, Math.min(last, st.row + d));
    if (r !== st.row || st.zone !== 'body') mv({ zone: 'body', row: r, col: Math.min(st.col, list.length - 1 - r * COLS) });
  };
  const focusSearch = () => { up({ zone: 'search' }); setTimeout(() => searchRef.current?.focus(), 30); };
  const pickChip = (i: number) => {
    const c = chips[i]!;
    if (c === 'sort') { const j = SORTS.findIndex(s => s[0] === st.sort); sfx.play('ok'); up({ sort: SORTS[(j + 1) % SORTS.length]![0], filter: st.filter === 'top' ? 'all' : st.filter, row: 0, col: 0 }); return; }
    sfx.play('ok'); up({ filter: c, q: '', row: 0, col: 0, chip: i });
  };
  const toChip = (i: number) => { const c = chips[i]!; sfx.play('move'); up(c === 'sort' ? { chip: i } : { chip: i, filter: c, q: '', row: 0, col: 0 }); };
  const gIdx = grp ? groups.findIndex(x => x[0] === grp) + 1 : 0;
  const toGroup = (i: number) => { sfx.play('move'); up({ grp: i === 0 ? null : groups[i - 1]![0], row: 0, col: 0 }); };
  const below = hasGroups ? 'groups' : 'body';

  useKeys((k: Key) => {
    if (st.menu) {
      if (k === 'ArrowDown' && st.mi < opts.length - 1) mv({ mi: st.mi + 1 });
      else if (k === 'ArrowUp' && st.mi > 0) mv({ mi: st.mi - 1 });
      else if (k === 'Enter' && g && opts[st.mi]) { up({ menu: false }); run(opts[st.mi]!.k, g); }
      else if (k === 'Escape' || k === 'X') { sfx.play('back'); up({ menu: false }); }
      return;
    }
    if (k === 'Y') return focusSearch();
    if ((k === 'LB' || k === 'RB') && (onTab || onSection)) return (onTab ?? onSection)!(k === 'RB' ? 1 : -1);
    if (k === 'LB' || k === 'RB') { const i = FILTERS.findIndex(f => f[0] === st.filter); const n = (i + (k === 'RB' ? 1 : -1) + FILTERS.length) % FILTERS.length; sfx.play('move'); up({ filter: FILTERS[n]![0], chip: n, q: '', row: 0, col: 0 }); return; }
    if (st.zone === 'search') {
      if (k === 'Enter') { sfx.play('ok'); searchRef.current?.focus(); }
      else if (k === 'ArrowDown') mv({ zone: onTab ? below : 'chips' });
      else if (k === 'ArrowRight' && onTab) mv({ zone: 'chips', chip: Math.max(0, FILTERS.findIndex(f => f[0] === st.filter)) });
      else if (k === 'ArrowUp' && onTopEdge) onTopEdge();
      else if (k === 'Escape') { if (st.q) { sfx.play('back'); up({ q: '' }); } else mv({ zone: 'body' }); }
      return;
    }
    if (st.zone === 'chips') {
      if (k === 'ArrowLeft' && st.chip > 0) toChip(st.chip - 1);
      else if (k === 'ArrowLeft' && onTab) mv({ zone: 'search' });
      else if (k === 'ArrowRight' && st.chip < chips.length - 1) toChip(st.chip + 1);
      else if (k === 'Enter') { if (chips[st.chip] === 'sort') pickChip(st.chip); else if (total) mv({ zone: below }); }
      else if (k === 'ArrowUp' && !onTab) mv({ zone: 'search' });
      else if (k === 'ArrowDown') { if (hasGroups) mv({ zone: 'groups' }); else if (total) mv({ zone: 'body' }); }
      else if (k === 'Escape') { sfx.play('back'); onBack(); }
      return;
    }
    if (st.zone === 'groups') {
      if (k === 'ArrowLeft' && gIdx > 0) toGroup(gIdx - 1);
      else if (k === 'ArrowRight' && gIdx < groups.length) toGroup(gIdx + 1);
      else if (k === 'ArrowUp') mv({ zone: 'chips', chip: Math.max(0, FILTERS.findIndex(f => f[0] === st.filter)) });
      else if ((k === 'ArrowDown' || k === 'Enter') && total) mv({ zone: 'body' });
      else if (k === 'Escape') { sfx.play('back'); onBack(); }
      return;
    }
    if (k === 'Escape') { if (st.q) { sfx.play('back'); up({ q: '', row: 0, col: 0 }); } else { sfx.play('back'); onBack(); } return; }
    if (!g) { if (k === 'ArrowUp') mv({ zone: hasGroups ? 'groups' : 'chips' }); return; }
    if (k === 'Enter') { sfx.play('ok'); onOpen(g); return; }
    if (k === 'X') { sfx.play('ok'); up({ menu: true, mi: 0 }); return; }
    if (shelves) {
      const n = list.length;
      if (k === 'ArrowRight' && st.col < n - 1) mv({ col: st.col + 1 });
      else if (k === 'ArrowLeft' && st.col > 0) mv({ col: st.col - 1 });
      else if (k === 'ArrowDown' && st.row < rows.length - 1) mv({ row: st.row + 1, col: Math.min(st.col, rows[st.row + 1]!.items.length - 1) });
      else if (k === 'ArrowUp') { if (st.row > 0) mv({ row: st.row - 1, col: Math.min(st.col, rows[st.row - 1]!.items.length - 1) }); else mv(hasGroups ? { zone: 'groups' } : { zone: 'chips', chip: FILTERS.findIndex(f => f[0] === st.filter) }); }
      else if (k === 'RT') mv({ row: Math.min(rows.length - 1, st.row + 2), col: 0 });
      else if (k === 'LT') mv({ row: Math.max(0, st.row - 2), col: 0 });
      return;
    }
    const n = list.length, i = idx;
    if (k === 'ArrowRight' && st.col < COLS - 1 && i + 1 < n) mv({ col: st.col + 1 });
    else if (k === 'ArrowLeft' && st.col > 0) mv({ col: st.col - 1 });
    else if (k === 'ArrowDown' && i + COLS < n) mv({ row: st.row + 1 });
    else if (k === 'ArrowDown' && st.row < Math.floor((n - 1) / COLS)) mv({ row: st.row + 1, col: (n - 1) % COLS });
    else if (k === 'ArrowUp') { if (st.row > 0) mv({ row: st.row - 1 }); else mv(hasGroups ? { zone: 'groups' } : { zone: 'chips', chip: FILTERS.findIndex(f => f[0] === st.filter) }); }
    else if (k === 'RT') { const r = Math.min(Math.floor((n - 1) / COLS), st.row + 2); mv({ row: r, col: Math.min(st.col, n - 1 - r * COLS) }); }
    else if (k === 'LT') mv({ row: Math.max(0, st.row - 2) });
  }, active);

  const focusBody = st.zone === 'body' && !st.menu;
  const card = (x: HubGame, on: boolean, click: () => void) => (
    <button key={x.key} className={`dsc-c ${on ? 'on' : ''} ${x.installed ? 'inst' : ''}`} onClick={click}>
      <span className="cv-w"><GameArt title={x.title} console={x.console} platformName={x.platformName} fallback={x.coverUrl} variant="cover" />
        {x.isNew && <span className="b new">{tt('NOVO')}</span>}{x.installed && !x.installed.missing && <span className="b inst">{tt('INSTALADO')}</span>}</span>
      <span className="t">{x.title}</span>
    </button>
  );
  const visRows = 2, rowTop = shelves ? Math.max(0, Math.min(st.row, rows.length - visRows)) : Math.max(0, st.row - 1);

  return (
    <div className={`dsc ${theme} ${shape} ${onTab ? 'in-tabs' : ''} ${hasGroups ? 'has-groups' : ''} ${active ? '' : 'idle'}`}>
      <div className="dsc-hd">
        <h2>{title}<small>{cname}</small></h2>
        <div className={`dsc-q ${st.zone === 'search' ? 'f' : ''}`} onClick={focusSearch}>
          <span className="ic">⌕</span>
          <SearchBox ref={searchRef} value={st.q} nav={false} className="dsc-qi" placeholder={tt('Buscar em {0} por nome, estúdio ou ano', { 0: place ?? cname })}
            onChange={v => up({ q: v, row: 0, col: 0 })} onDone={() => up({ zone: st.q.trim() ? 'body' : 'chips' })} />
          {st.q && <span className="cnt">{plural(grid.length, tt('resultado'), tt('resultados'))}</span>}
        </div>
      </div>
      <div className="dsc-chips">
        {FILTERS.map(([k, l], i) => (
          <button key={k} className={`${st.filter === k && !q ? 'cur' : ''} ${st.zone === 'chips' && st.chip === i ? 'on' : ''}`} onClick={() => pickChip(i)}>{l}</button>
        ))}
        <span className="sp" />
        <button className={`sort ${st.zone === 'chips' && st.chip === FILTERS.length ? 'on' : ''}`} onClick={() => pickChip(FILTERS.length)}>{tt('Ordenar: {0}', { 0: SORTS.find(s => s[0] === st.sort)![1] })}</button>
      </div>

      {hasGroups && (
        <div className={`dsc-groups ${st.zone === 'groups' ? 'f' : ''}`} ref={grpRef}>
          <span className="lb">{groupLabel}</span>
          {[['', all.length + allExtra.length] as [string, number], ...groups].map(([k, n], i) => (
            <button key={k || '*'} className={`${i === gIdx ? 'cur' : ''} ${st.zone === 'groups' && i === gIdx ? 'on' : ''}`} onClick={() => { up({ zone: 'groups' }); toGroup(i); }}>
              {k || allLabel}<small>{n}</small>
            </button>
          ))}
        </div>
      )}
      <div className="dsc-body" ref={bodyRef} onWheel={onWheel}>
        {shelves ? (
          <div className="dsc-in" style={{ transform: `translateY(-${rowTop * ROW_H}px)` }}>
            {rows.map((r, ri) => {
              const cur = ri === Math.min(st.row, rows.length - 1);
              const off = cur ? Math.max(0, Math.min(st.col - 2, r.items.length - COLS)) : 0;
              return (
                <section key={r.key} className={`dsc-row ${cur ? 'cur' : ''}`}>
                  <h3>{r.title}<small>{r.items.length}</small></h3>
                  <div className="dsc-strip" style={{ transform: `translateX(-${off * (CARD_W + GAP)}px)` }}>
                    {r.items.map((x, ci) => card(x, focusBody && cur && ci === st.col, () => { if (focusBody && cur && ci === st.col) onOpen(x); else mv({ zone: 'body', row: ri, col: ci }); }))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : list.length ? (
          <>
            {!grid.length && suggest.length > 0 && <div className="dsc-msg">{tt('Nada encontrado para “{0}”. Você quis dizer:', { 0: q })}</div>}
            <div className="dsc-grid" style={{ transform: `translateY(-${rowTop * GRID_ROW}px)` }}>
              {list.map((x, i) => card(x, focusBody && i === idx, () => { if (focusBody && i === idx) onOpen(x); else mv({ zone: 'body', row: Math.floor(i / COLS), col: i % COLS }); }))}
            </div>
          </>
        ) : (
          <div className="dsc-msg">{q ? tt('Nada encontrado para “{0}”.', { 0: q }) : games.length ? tt('Nada com esse filtro.') : tt('O catálogo ainda não tem jogos de {0}. O radar avisa quando aparecer o primeiro.', { 0: cname })}</div>
        )}
      </div>

      <aside className="dsc-det">{g ? <Detail g={g} self={self} /> : <div className="dsc-none">{plural(total, tt('jogo'), tt('jogos'))}</div>}</aside>

      {st.menu && g && (
        <div className="dsc-menu">
          <h4>{g.title}</h4>
          {opts.map((o, j) => <button key={o.k + j} className={j === st.mi ? 'on' : ''} onClick={() => { up({ menu: false }); run(o.k, g); }}>{o.icon}{o.l}</button>)}
        </div>
      )}
      {hints !== false && (
        <div className="dsc-ft">
          {st.menu ? <><span><Glyph a="ok" />{tt('Confirmar')}</span><span><Glyph a="back" />{tt('Fechar')}</span></>
            : st.zone === 'search' ? <><span><Glyph a="ok" />{tt('Digitar')}</span><span><Glyph a={onTab ? 'lr' : 'ud'} />{tt('Filtros')}</span><span><Glyph a="back" />{st.q ? tt('Limpar') : tt('Voltar')}</span></>
            : st.zone === 'groups' ? <><span><Glyph a="lr" />{groupLabel}</span><span><Glyph a="ud" />{tt('Jogos')}</span><span><Glyph a="back" />{tt('Voltar')}</span></>
            : st.zone === 'chips' ? <><span><Glyph a="lr" />{tt('Filtro')}</span>{onTab && <span><Glyph a="lb" /><Glyph a="rb" />{tt('Seção')}</span>}<span><Glyph a="ok" />{tt('Escolher')}</span><span><Glyph a="back" />{tt('Voltar')}</span></>
            : <><span><Glyph a="ok" />{tt('Ver jogo')}</span><span><Glyph a="x" />{tt('Ações')}</span><span><Glyph a="y" />{tt('Buscar')}</span><span><Glyph a="lb" /><Glyph a="rb" />{onTab ? tt('Seção') : tt('Filtro')}</span><span><Glyph a="back" />{st.q ? tt('Limpar busca') : tt('Voltar')}</span></>}
        </div>
      )}
    </div>
  );
}

function Detail({ g, self }: { g: HubGame; self: boolean }) {
  const needs = useTranslated(g.catalog?.needs);
  const i = g.installed;
  const info = useInfo(g.console, g.title, g.platformName, i?.id, g.catalog?.id), score = info?.score ?? null;
  const ttb = info?.ttb?.h ?? info?.ttb?.n ?? info?.ttb?.c ?? null;
  return (
    <div className="dsc-d" key={g.key}>
      <span className="cv-w"><GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant="cover" /></span>
      <h3>{g.title}</h3>
      <p className="meta">{[g.catalog?.year, g.catalog?.developer].filter(Boolean).join(' · ') || g.platformName}</p>
      <div className="pills">
        {score && <span className={`pill score ${score.value >= 75 ? 'hi' : score.value >= 50 ? 'mid' : 'lo'}`} title={`${score.by === 'IGDB' ? tt('Média da crítica (IGDB)') : tt('Nota do {0}', { 0: score.by })}${score.platform ? ` · ${score.platform}` : ''}`}>{score.value}</span>}
        {ttb && <span className="pill ttb" title={tt('Tempo para zerar, média de jogadores no IGDB.com')}>{Math.floor(ttb)}h{ttb % 1 ? '30' : ''}</span>}
        {g.status && <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
        {g.isNew && <span className="pill new">{tt('Novo')}</span>}
        {i && <span className="pill inst">{i.missing ? (i.uninstalled ? tt('Não instalado') : tt('Pasta não encontrada')) : i.playMs ? tt('{0} jogadas', { 0: fmtPlay(i.playMs) }) : tt('Instalado')}</span>}
      </div>
      {needs.text && <p className="needs"><b>{tt('Precisa:')}</b> {needs.text}</p>}
      {self && !i && <p className="needs">{SELF_INSTALL_NOTE}</p>}
    </div>
  );
}
