import { useProfile } from '../lib/profile';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, InstalledGame } from '@shared/types';
import { useTRPC } from '../trpc';
import { Hints, useKeys, usePadKind, PAD_NAMES } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { setSettings, useSettings } from '../lib/settings';
import { clockStr, fmtPlay, plural } from '../lib/format';
import { initAudio, sfx } from '../lib/sfx';
import { MAKERS, MAKER_LABEL, otherConsoles, type StageConsole } from '../stage/consoles';
import { Home, setCaption } from './Home';
import { MePart, RadarPart } from '../lazy';
import { tt } from '@shared/i18n';

export type Page = 'act' | 'stage';
interface Props {
  active: boolean;
  list: StageConsole[];
  page: Page; setPage: (p: Page) => void;
  sel: number; setSel: (i: number | ((prev: number) => number)) => void;
  onEnterConsole: (id: ConsoleId, opts?: { game?: string; tab?: 'lib' | 'cat' }) => void;
  onSettings: () => void;
  onAll: () => void;
  onMenu: () => void;
}

function Clock() {
  const [t, setT] = useState(clockStr());
  useEffect(() => { const i = setInterval(() => setT(clockStr()), 15_000); return () => clearInterval(i); }, []);
  return <span className="clock">{t}</span>;
}

export function Select({ active, list, page, setPage, sel, setSel, onEnterConsole, onSettings, onAll, onMenu }: Props) {
  const me = useProfile();
  const trpc = useTRPC(), qc = useQueryClient();
  const summary = useQuery(trpc.library.summary.queryOptions());
  const games = useQuery(trpc.games.list.queryOptions());
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({
    onSuccess: g => { void qc.invalidateQueries(); if (g) onEnterConsole(g.console, { game: g.id }); },
  }));
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const [ov, setOv] = useState<null | 'radar' | 'me'>(null);
  const [zone, setZone] = useState<'car' | 'top' | 'grp'>('car');
  useEffect(() => { if (page !== 'stage') setZone('car'); }, [page]);
  const root = useRef<HTMLElement>(null);
  const pad = usePadKind();
  const s = useSettings();

  const go = (p: Page) => { sfx.play('ok'); setPage(p); };
  const move = (d: number) => { initAudio(); sfx.play('move'); setSel(prev => prev + d); };
  const openGame = (g: InstalledGame) => onEnterConsole(g.console, { game: g.id });

  const makers = MAKERS.filter(m => list.some(x => x.maker === m));
  useKeys(k => {
    initAudio();
    if (zone === 'grp') {
      const mi = Math.max(0, makers.indexOf(list[sel]!.maker));
      if (k === 'ArrowLeft' || k === 'ArrowRight') { const m = makers[(mi + (k === 'ArrowRight' ? 1 : -1) + makers.length) % makers.length]!; sfx.play('move'); setSel(list.findIndex(x => x.maker === m)); }
      else if (k === 'ArrowUp' || k === 'Escape') { sfx.play('move'); setZone('car'); }
      else if (k === 'Enter') onEnterConsole(list[sel]!.id);
      return;
    }
    if (k === 'ArrowLeft' || k === 'LB') move(-1);
    else if (k === 'ArrowRight' || k === 'RB') move(1);
    else if (k === 'ArrowUp') { sfx.play('move'); setZone('top'); }
    else if (k === 'ArrowDown') { sfx.play('move'); setZone('grp'); }
    else if (k === 'Enter') onEnterConsole(list[sel]!.id);
    else if (k === 'Escape' || k === 'Tab' || k === 'Select') go('act');
  }, active && page === 'stage' && !ov && zone !== 'top');

  useSpatialNav(root, {
    active: active && page === 'stage' && !ov && zone === 'top', initial: '.seg .on',
    onKey: k => {
      if (k === 'ArrowDown' || k === 'Escape') { sfx.play('move'); setZone('car'); return true; }
      if (k === 'Select' || k === 'Tab') { go('act'); return true; }
    },
  });

  useSpatialNav(root, {
    active: active && page === 'act' && !ov, initial: '[data-main]',
    onFocus: setCaption,
    onKey: k => { if (k === 'LB') { sfx.play('ok'); onAll(); return true; } if (k === 'Tab' || k === 'RB' || k === 'Select') { go('stage'); return true; } if (k === 'Escape') return true; },
  });

  const c = list[sel]!, group = c.id === 'other' ? otherConsoles(s.hidden) : [c.id];
  const pc = group.reduce((t, id) => { const x = summary.data?.perConsole[id]; return x ? { recomps: t.recomps + x.recomps, installed: t.installed + x.installed, fresh: t.fresh + x.fresh, platforms: t.platforms + x.platforms } : t; },
    { recomps: 0, installed: 0, fresh: 0, platforms: 0 });
  const unseen = summary.data?.radar.unseen ?? 0;

  return (
    <section className="view select" ref={root} aria-label={tt('Cosmo')}>
      <header className="topbar">
        <div className="logo glow"><i />{tt('COSMO')}</div>
        <div className="seg" role="tablist">
          <button role="tab" data-hf className={page === 'act' ? 'on' : ''} aria-selected={page === 'act'} onClick={() => go('act')}>{tt('INÍCIO')}</button>
          <button role="tab" data-hf className={page === 'stage' ? 'on' : ''} aria-selected={page === 'stage'} onClick={() => { go('stage'); setZone('car'); }}>{tt('CONSOLES')}</button>
          <button role="tab" data-hf onClick={() => { sfx.play('ok'); onAll(); }}>{tt('TODOS OS JOGOS')}</button>
        </div>
        <div className="top-right">
          <button className={`hm-pill ${unseen ? 'has' : ''}`} data-hf data-cap={tt('Radar')} onClick={() => { sfx.play('ok'); setOv('radar'); }}><i />{unseen ? plural(unseen, tt('novidade'), tt('novidades')) : 'radar'}</button>
          <button className="hm-set" data-hf aria-label={tt('Configurações')} title={tt('Configurações (S)')} onClick={onSettings}>⚙</button>
          <button className="hm-set hm-menu" data-hf aria-label={tt('Menu do Cosmo')} title={tt('Menu do Cosmo (Start no controle, F1 no teclado)')} onClick={onMenu}>☰</button>
          <button className="hm-me" data-hf aria-label={tt('Perfil de {0}', { 0: me.name })} title={me.name} style={{ background: me.color }} onClick={() => { sfx.play('ok'); setOv('me'); }}>{me.initial}</button>
          <Clock />
        </div>
      </header>

      {page === 'act' && <Home games={games.data?.filter(g => !g.missing)} summary={summary.data} onOpenGame={openGame} onPlay={g => { initAudio(); if (g.missing) return openGame(g); sfx.play('ok'); play.mutate({ id: g.id }); }} playError={play.error?.message ?? null} onStage={() => go('stage')} onAddGame={() => add.mutate()} adding={add.isPending} starting={play.isPending ? play.variables?.id ?? null : null} />}

      {page === 'stage' && (
        <div className="stage-ui">
          <div className="cname glow" style={{ color: c.color }}>{c.name.toUpperCase()}</div>
          <div className="cmeta">
            {c.id === 'other' ? plural(pc.platforms, tt('plataforma'), tt('plataformas')) : `${c.maker} · ${c.year}`}
            {' · '}{pc?.recomps ? plural(pc.recomps, tt('recomp'), tt('recomps')) : tt('nenhum recomp ainda')}
            {pc?.installed ? ` · ${plural(pc.installed, tt('instalado'), tt('instalados'))}` : ''}
            {(() => { const ms = (games.data ?? []).filter(g => group.includes(g.console)).reduce((s, g) => s + g.playMs, 0); return ms ? ` · ${fmtPlay(ms)}` : ''; })()}
            {pc?.fresh ? <> · <b>{plural(pc.fresh, tt('novo'), tt('novos'))}</b></> : null}
          </div>
          <div className="nav">
            <button className="arrow" aria-label={tt('Console anterior')} onClick={() => move(-1)}>◀</button>
            <button className="enter" onClick={() => { initAudio(); onEnterConsole(c.id); }}>{tt('LIGAR')}</button>
            <button className="arrow" aria-label={tt('Próximo console')} onClick={() => move(1)}>▶</button>
          </div>
          <div className="groups">
            {MAKERS.filter(m => list.some(x => x.maker === m)).map(m => (
              <div key={m} className={`grp ${c.maker === m ? 'on' : ''} ${zone === 'grp' && c.maker === m ? 'f' : ''}`}>
                <button onClick={() => setSel(list.findIndex(x => x.maker === m))}>{MAKER_LABEL[m]}</button>
                <div className="d">{list.map((x, i) => x.maker === m && <button key={x.id} className={i === sel ? 'on' : ''} aria-label={x.name} title={x.name} onClick={() => setSel(i)} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {add.error && <div className="toasts"><div className="toast"><div className="toast-k">{tt('NÃO DEU PARA ADICIONAR')}</div><div className="toast-g">{add.error.message}</div></div></div>}

      <Hints items={page === 'act' ? [['ok', tt('Abrir')], ['sel', tt('Consoles')], ['lb', tt('Todos os jogos')], ['menu', tt('Menu')]] : zone === 'top' ? [['lr', tt('Mover')], ['ok', tt('Abrir')], ['ud', tt('Voltar ao palco')]] : zone === 'grp' ? [['lr', tt('Fabricante')], ['ok', tt('Ligar')], ['ud', tt('Palco')]] : [['lr', tt('Console')], ['ok', tt('Ligar')], ['ud', tt('Menu e fabricantes')], ['menu', tt('Menu')]]} />
      <div className="sel-tools">
        <button className="icon-btn" data-hf title={tt('Trocar botões mostrados (C)')} onClick={() => {
          const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(s.pad) + 1) % o.length]! });
        }}>🎮 {s.pad === 'auto' ? tt('Auto: {0}', { 0: PAD_NAMES[pad] }) : PAD_NAMES[s.pad]}</button>
      </div>

      <Suspense fallback={null}>
        {ov === 'radar' && <RadarPart.C onClose={() => setOv(null)} onOpenConsole={id => { setOv(null); onEnterConsole(id, { tab: 'cat' }); }} />}
        {ov === 'me' && <MePart.C onClose={() => setOv(null)} />}
      </Suspense>
    </section>
  );
}
