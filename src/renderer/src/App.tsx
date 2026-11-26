import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import type { CompleteEvent, ConsoleId, PlayEvent, UnlockEvent } from '@shared/types';
import { pushProgress } from './lib/progress';
import { fmtPlay } from './lib/format';
import { useTRPC } from './trpc';
import { getSettings, reduceMotion, setSettings, useSettings } from './lib/settings';
import { applyPalette, paletteById, PALETTES } from './lib/palettes';
import { Glyph, setGlobalKeys, setShortcutHandler } from './lib/input';
import { getLang, tt } from '@shared/i18n';
import { fmtPct, isRare } from '@shared/rarity';
import { useConfirmReq } from './lib/dialogs';
import { BindRecHost, CartuchoMenu, ConfirmHost, PickerHost, PlatformHost, DownloadAskHost } from './views/GlobalUI';
import { AllGamesPart, ConsoleViewPart, MePart, PickerPart, RadarPart, SettingsPart, StagePart, SupportPart, preloadAll } from './lazy';
import { askConfirm } from './lib/dialogs';
import { CONSOLES } from './stage/consoles';
import { sfx } from './lib/sfx';
import { focusSearch } from './lib/search';
import { routeConsole, visibleConsoles } from './stage/consoles';
import { Boot } from './views/Boot';
import { Platina } from './views/Platina';
import { Select, type Page } from './views/Select';
import { HUBS } from './hubs';
import { TitleBar } from './components/TitleBar';
import { WebHost } from './components/WebHost';

type Inside = { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; key: number };
const LAST = 'cartucho.lastConsole';

export function App() {
  const s = useSettings();
  const palette = paletteById(s.pal);
  useEffect(() => applyPalette(palette), [palette]);

  const [booting, setBooting] = useState(s.boot);
  const [page, setPage] = useState<Page>(s.start);
  const list = useMemo(() => visibleConsoles(s.hidden), [s.hidden]);
  const [selId, setSelId] = useState(() => localStorage.getItem(LAST) ?? 'snes');
  const sel = Math.max(0, list.findIndex(c => c.id === selId));
  const setSel = (v: number | ((prev: number) => number)) => setSelId(prev => {
    const i = typeof v === 'function' ? v(Math.max(0, list.findIndex(c => c.id === prev))) : v;
    return list[((i % list.length) + list.length) % list.length]!.id;
  });
  useEffect(() => { try { localStorage.setItem(LAST, list[sel]!.id); } catch { } }, [sel, list]);
  const [picker, setPicker] = useState(false);
  const [inside, setInside] = useState<Inside | null>(null);
  const [all, setAll] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [gov, setGov] = useState<null | 'radar' | 'me' | 'support'>(null);
  const confirmReq = useConfirmReq();
  const [tvAnim, setTvAnim] = useState<'' | 'off' | 'on'>('');
  type Toast = { k: string; n: string; g: string; icon?: string | null; ach?: boolean; rare?: boolean; out?: boolean };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [playing, setPlaying] = useState<Record<string, string>>({});
  const dropToast = (t: Toast) => { setToasts(x => x.map(y => (y === t ? { ...y, out: true } : y))); setTimeout(() => setToasts(x => x.filter(y => y !== t && !(y.out && y.n === t.n && y.g === t.g))), 320); };
  const toast = (t: Toast) => { setToasts(x => [...x.slice(-3), t]); setTimeout(() => dropToast(t), t.ach ? 7000 : 6000); };

  const trpc = useTRPC(), qc = useQueryClient();
  const resume = useMutation(trpc.ingame.back.mutationOptions());
  const syncLang = useMutation(trpc.system.setLang.mutationOptions());
  useEffect(() => { syncLang.mutate({ lang: getLang() }); }, []);
  // A abertura aparece primeiro; o resto (palco 3D, telas dos consoles…) carrega durante a animação.
  useEffect(() => { const r = requestAnimationFrame(() => setTimeout(preloadAll, 0)); return () => cancelAnimationFrame(r); }, []);
  const [away, setAway] = useState<string | null>(null);
  const [winFocus, setWinFocus] = useState(() => document.hasFocus());
  useEffect(() => { const on = () => setWinFocus(true), off = () => setWinFocus(false); addEventListener('focus', on); addEventListener('blur', off); return () => { removeEventListener('focus', on); removeEventListener('blur', off); }; }, []);
  useSubscription(trpc.ingame.onShot.subscriptionOptions(undefined, { onData: () => void qc.invalidateQueries({ queryKey: trpc.ingame.shots.pathKey() }) }));
  useSubscription(trpc.ingame.onSummon.subscriptionOptions(undefined, { onData: title => { sfx.play('ok'); setAway(title); } }));
  const back = () => { sfx.play('ok'); setAway(null); resume.mutate(); };
  useEffect(() => { const f = () => setAway(null); addEventListener('blur', f); return () => removeEventListener('blur', f); }, []);
  const overlay = useMutation(trpc.win.overlay.mutationOptions());
  const installUpd = useMutation(trpc.updates.install.mutationOptions());
  const asked = useRef<string | null>(null);
  const [updReady, setUpdReady] = useState<string | null>(null);
  useSubscription(trpc.updates.onState.subscriptionOptions(undefined, {
    onData: u => {
      qc.setQueryData(trpc.updates.state.queryKey(), u);
      if (u.status === 'ready' && u.version) setUpdReady(u.version);
    },
  }));
  useEffect(() => { overlay.mutate({ color: palette.bg0, symbol: palette.acc }); }, [palette.id]);
  const summary = useQuery(trpc.library.summary.queryOptions());

  const timers = useRef<number[]>([]);
  const transition = (fn: () => void) => {
    if (reduceMotion()) return fn();
    timers.current.forEach(clearTimeout);
    setTvAnim('off');
    timers.current = [window.setTimeout(() => { fn(); setTvAnim('on'); timers.current.push(window.setTimeout(() => setTvAnim(''), 460)); }, 420)];
  };

  const enterConsole = (id0: ConsoleId, opts: { game?: string; tab?: 'lib' | 'cat' } = {}) => {
    const id = routeConsole(id0, getSettings().hidden);
    setSelId(id); setZoom(true); sfx.play('ok');
    transition(() => setInside({ id, ...opts, key: Date.now() }));
  };
  const leaveConsole = () => transition(() => { setInside(null); setAll(false); setZoom(false); setPage('stage'); });
  const openAll = () => transition(() => setAll(true));
  const closeAll = () => transition(() => { setAll(false); setPage('act'); });

  const gk = useRef({ booting, picker, confirmReq, inside, leaveConsole, all, closeAll, gameOpen: false, back: () => {} });
  gk.current = { booting, picker, confirmReq, inside, leaveConsole, all, closeAll, gameOpen: Object.keys(playing).length > 0 || away != null, back };
  useEffect(() => setGlobalKeys(k => {
    const g = gk.current;
    if (g.booting || g.picker || g.confirmReq || document.querySelector('.osk-ov, .gl-pick, .gl-plat, .gl-padset, .web-ov')) return false;
    if (k === 'Start') { sfx.play(menu ? 'back' : 'ok'); setMenu(m => !m); return true; }
    if (k === 'Home' && g.gameOpen) { g.back(); return true; }
    if (k === 'Home') { setMenu(false); setGov(null); setSettingsOpen(false); if (g.inside) g.leaveConsole(); else if (g.all) g.closeAll(); else setPage('stage'); sfx.play('back'); return true; }
    return false;
  }), [menu]);

  useEffect(() => setShortcutHandler(key => {
    const k = key.toLowerCase();
    if (k === 's' && !booting && !picker) { setSettingsOpen(o => !o); return true; }
    if (k === 'm') { setSettings({ snd: !getSettings().snd }); return true; }
    if (k === 'c') { const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(getSettings().pad) + 1) % o.length]! }); return true; }
    if (k === '/') { if (!focusSearch()) dispatchEvent(new Event('cartucho:search')); return true; }
    if (k === 'p') { const i = PALETTES.findIndex(p => p.id === getSettings().pal); setSettings({ pal: PALETTES[(i + 1) % PALETTES.length]!.id }); return true; }
    return false;
  }), [booting, picker]);

  useSubscription(trpc.achievements.onUnlock.subscriptionOptions(undefined, {
    onData: (e: UnlockEvent) => {
      // Rara (menos de 5% dos jogadores): outro som e o aviso em roxo e ciano, com a porcentagem.
      if (isRare(e.rarity)) { sfx.rare(); toast({ k: tt('CONQUISTA RARA · {0}% DOS JOGADORES', { 0: fmtPct(e.rarity) }), n: e.name, g: e.gameTitle, icon: e.icon ?? null, ach: true, rare: true }); return; }
      sfx.achievement(); toast({ k: tt('CONQUISTA DESBLOQUEADA'), n: e.name, g: e.gameTitle, icon: e.icon ?? null, ach: true });
    },
  }));
  // 100% das conquistas: entra na fila e aparece quando o Cosmo está na frente (durante o jogo, o aviso dourado já saiu por cima dele).
  const [plats, setPlats] = useState<CompleteEvent[]>([]);
  useSubscription(trpc.achievements.onComplete.subscriptionOptions(undefined, { onData: (e: CompleteEvent) => setPlats(q => [...q, e]) }));
  // Começa com o Cosmo na frente; depois de começar, fica até fechar (trocar de janela no meio não some com ela).
  const [platOn, setPlatOn] = useState(false);
  useEffect(() => { if (!platOn && plats.length && winFocus && !booting) setPlatOn(true); }, [platOn, plats.length, winFocus, booting]);
  useSubscription(trpc.ports.onProgress.subscriptionOptions(undefined, {
    onData: p => { pushProgress(p); if (p.done) { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); } },
  }));
  useSubscription(trpc.art.onChanged.subscriptionOptions(undefined, { onData: () => void qc.invalidateQueries({ queryKey: trpc.art.pathKey() }) }));
  useSubscription(trpc.play.onEvent.subscriptionOptions(undefined, {
    onData: (e: PlayEvent) => {
      setPlaying(p => { const { [e.gameId]: _, ...rest } = p; return e.running ? { ...rest, [e.gameId]: e.title } : rest; });
      if (!e.running) setAway(null);
      if (!e.running && e.sessionMs) toast({ k: tt('SESSÃO ENCERRADA'), n: fmtPlay(e.sessionMs), g: e.title });
      void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.play.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() });
    },
  }));
  useSubscription(trpc.achievements.onChanged.subscriptionOptions(undefined, {
    onData: () => { void qc.invalidateQueries({ queryKey: trpc.games.list.queryKey() }); void qc.invalidateQueries({ queryKey: trpc.achievements.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); },
  }));

  const tvClass = useMemo(() => [
    tvAnim, (inside && HUBS[inside.id]?.hd) || all ? 'hd' : '', s.crtLvl ? '' : 'no-crt', s.flicker && !s.reduce ? '' : 'no-flicker', s.frame ? '' : 'no-frame',
    s.glow ? '' : 'no-glow', s.blur ? '' : 'no-blur', s.reduce ? 'reduce' : '', s.skin === 'classic' ? '' : 'cosmo-skin',
  ].filter(Boolean).join(' '), [tvAnim, s, inside, all]);

  const gameOpen = Object.keys(playing).length > 0;
  useEffect(() => {
    if (!updReady || gameOpen || booting || asked.current === updReady) return;
    asked.current = updReady;
    void askConfirm({ title: tt('Cosmo {0} pronto', { 0: updReady }), text: tt('A atualização já foi baixada. Reiniciar agora? O Cosmo fecha, instala e abre de novo sozinho em alguns segundos. Se preferir deixar para depois, ela entra quando você fechar o Cosmo.'), ok: tt('Reiniciar agora'), cancel: tt('Depois') })
      .then(y => { if (y) installUpd.mutate(); });
  }, [updReady, gameOpen, booting]);
  const stageMode = inside || all || (gameOpen && !winFocus) ? 'hidden' : booting || page === 'act' ? 'behind' : 'stage';
  const askPicker = picker || (!s.picked && !booting && !inside && !settingsOpen && page === 'stage');

  return (
    <>
    <TitleBar ctx={inside ? CONSOLES.find(c => c.id === inside.id)?.name ?? null : all ? tt('Todos os jogos') : null} onMenu={() => { sfx.play('ok'); setMenu(true); }} />
    <div id="tv" className={tvClass} style={{ ['--crt' as string]: s.crtLvl / 100 }}>
      <Suspense fallback={<div className={`stage stage-${stageMode}`} />}><StagePart.C list={list} sel={sel} mode={stageMode} zoom={zoom} palette={palette} pixel={s.pixelStage} sleep={gameOpen && !winFocus} onSelect={i => { sfx.play('move'); setSel(i); }} onEnter={i => enterConsole(list[i]!.id)} /></Suspense>
      <Suspense fallback={null}>{all && !inside && <AllGamesPart.C onBack={closeAll} />}</Suspense>
      {!inside && !all && (
<Select active={!booting && !settingsOpen && !askPicker && !menu && !gov} list={list} page={page} setPage={setPage} sel={sel} setSel={setSel}
          onEnterConsole={enterConsole} onAll={openAll} onMenu={() => { sfx.play('ok'); setMenu(true); }} onSettings={() => { sfx.play('ok'); setSettingsOpen(true); }} />
      )}
      {inside && (() => {
        const H = HUBS[inside.id];
        if (H) return <Suspense fallback={null}><H.component key={inside.key} id={inside.id} game={inside.game} tab={inside.tab} onBack={leaveConsole} /></Suspense>;
        return <Suspense fallback={null}><ConsoleViewPart.C key={inside.key} id={inside.id} game={inside.game} tab={inside.tab} active={!settingsOpen} onBack={leaveConsole} /></Suspense>;
      })()}
      {menu && <CartuchoMenu inside={inside ? CONSOLES.find(c => c.id === inside.id)?.name ?? null : all ? tt('Todos os jogos') : null} onClose={() => setMenu(false)}
        onSettings={() => setSettingsOpen(true)} onRadar={() => setGov('radar')} onProfile={() => setGov('me')} onPickConsoles={() => setPicker(true)} onLeave={all ? closeAll : leaveConsole} onAll={openAll} onSupport={() => setGov('support')} />}
      <Suspense fallback={null}>{gov === 'radar' && <RadarPart.C onClose={() => setGov(null)} onOpenConsole={id => { setGov(null); enterConsole(id, { tab: 'cat' }); }} />}</Suspense>
      <Suspense fallback={null}>{gov === 'me' && <MePart.C onClose={() => setGov(null)} />}</Suspense>
      <Suspense fallback={null}>{gov === 'support' && <SupportPart.C onClose={() => setGov(null)} />}</Suspense>
      <ConfirmHost />
      <PickerHost />
      <PlatformHost />
      <DownloadAskHost />
      <BindRecHost />
      <WebHost />
      <Suspense fallback={null}>{settingsOpen && <SettingsPart.C onSupport={() => { setSettingsOpen(false); setGov('support'); }} onClose={() => setSettingsOpen(false)} onPickConsoles={() => { setSettingsOpen(false); setPicker(true); }} />}</Suspense>
      <Suspense fallback={null}>{askPicker && <PickerPart.C first={!s.picked} onClose={() => setPicker(false)} />}</Suspense>
      {booting && <Boot summary={summary.data} onDone={() => setBooting(false)} />}
      {platOn && plats[0] && <Platina key={plats[0].gameId + plats[0].at} e={plats[0]} onClose={() => { setPlatOn(false); setPlats(q => q.slice(1)); }} />}

      {(gameOpen || away != null) && <button className="playing" onClick={back}>▶ {Object.values(playing).join(', ') || away ? tt('JOGANDO {g}', { g: (Object.values(playing).join(', ') || away || '').toUpperCase() }) : tt('JOGO ABERTO')}<span className="pl-k"><Glyph a="home" />{tt('voltar para o jogo')}</span></button>}
      <div className="toasts">
        {toasts.map((t, i) => t.ach ? (
          <button key={i} className={`toast ach ${t.rare ? 'rare' : ''} ${t.out ? 'out' : ''}`} onClick={() => dropToast(t)}>
            <span className="toast-ic">{t.icon ? <img src={t.icon} alt="" /> : <i>{t.rare ? '◆' : '★'}</i>}</span>
            <span className="toast-b"><span className="toast-k">{t.k}</span><span className="toast-n">{t.n}</span><span className="toast-g">{t.g}</span></span>
          </button>
        ) : (
          <div key={i} className={`toast ${t.out ? 'out' : ''}`}>
            <div className="toast-k">{t.k}</div>
            <div className="toast-n">{t.n}</div>
            <div className="toast-g">{t.g}</div>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
