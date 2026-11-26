import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { Glyph, useKeys, type Key } from '../lib/input';
import { openWeb } from '../lib/web';
import { askConfirm } from '../lib/dialogs';
import { sfx } from '../lib/sfx';
import { ago, fmtPlay } from '../lib/format';
import { useArt, useInfo, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from './GameArt';
import { useGameProgress, type HubGame } from '../hubs/data';
import type { DOpt } from './Discover';
import type { GameAchievements as GameAchievementsData } from '@shared/types';
import { WineDialog } from './WineDialog';
import { getLang, tt } from '@shared/i18n';
import { fmtPct, isRare } from '@shared/rarity';

type Zone = 'meta' | 'score' | 'acts' | 'shots' | 'text' | 'side';
const MAIN = new Set(['update', 'ach', 'install', 'add', 'reinstall', 'relink', 'remove']);

export function GameView({ theme, g, opts: base, run, onBack, self, logo = true, extra }: {
  theme: string; g: HubGame; opts: DOpt[]; run: (k: string, g: HubGame) => void; onBack: () => void; self: boolean; logo?: boolean; extra?: ReactNode;
}) {
  const art = useArt(g.console, g.title, g.platformName);
  const lbShots = useShots(g.console, g.title, g.platformName);
  const capsQ = useQuery(useTRPC().ingame.shots.queryOptions({ title: g.title }, { enabled: !!g.installed }));
  const caps = capsQ.data ?? [];
  const shots = [...caps, ...lbShots];
  const info = useInfo(g.console, g.title, g.platformName, g.installed?.id, g.catalog?.id);
  const about = useTranslated(g.catalog?.description || (info?.lang === 'en' ? info.overview : null));
  const aboutText = about.text || (info?.lang === getLang() ? info.overview ?? '' : '');
  const score = info?.score ?? null;
  const hrs = (h: number) => `${Math.floor(h)}h${h % 1 ? '30' : ''}`;
  const ttb = info?.ttb ?? null;
  const ttbMain: [string, number] | null = ttb ? (ttb.h ? [tt('Campanha'), ttb.h] : ttb.n ? [tt('Com extras'), ttb.n] : ttb.c ? ['100%', ttb.c] : null) : null;
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const inst = g.installed;
  const trpc = useTRPC();
  const [note, setNote] = useState<string | null>(null);
  const lnk = useMutation(trpc.background.shortcut.mutationOptions({ onSuccess: () => setNote(tt('Atalho criado na Área de Trabalho. Ele abre o jogo pelo Cosmo e conta o tempo.')), onError: e => setNote(e.message) }));
  const qc = useQueryClient();
  const openShots = useMutation(trpc.ingame.openShots.mutationOptions());
  const dropShot = useMutation(trpc.ingame.removeShot.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.ingame.shots.pathKey() }) }));
  const askDrop = (j: number) => {
    const u = caps[j]; if (!u) return;
    sfx.play('ok');
    void askConfirm({ title: tt('Excluir esta captura?'), text: tt('A imagem vai para a Lixeira.'), ok: tt('Excluir'), cancel: tt('Manter'), danger: true }).then(y => {
      if (!y) return;
      dropShot.mutate({ url: u });
      setView(v => (v == null ? v : shots.length - 1 <= 1 ? null : Math.min(v, shots.length - 2)));
      setSi(x => Math.max(0, Math.min(x, shots.length - 2)));
    });
  };
  const plat = useMutation(trpc.games.changePlatform.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  // Capa própria: escolher uma imagem do computador ou voltar para a baixada.
  const coverDone = (msg: string) => { setNote(msg); void qc.invalidateQueries({ queryKey: trpc.art.get.pathKey() }); };
  const pickCover = useMutation(trpc.art.pickCover.mutationOptions({ onSuccess: ok => { if (ok) coverDone(tt('Capa trocada.')); }, onError: e => setNote(e.message) }));
  const resetCover = useMutation(trpc.art.resetCover.mutationOptions({ onSuccess: () => coverDone(tt('Capa original de volta.')), onError: e => setNote(e.message) }));
  const changeCover = () => { if (!g.console || pickCover.isPending) return; sfx.play('ok'); pickCover.mutate({ console: g.console, title: g.title }); };
  const dir = useMutation(trpc.games.relink.mutationOptions({
    onSuccess: r => { if (r) { setNote(tt('Pasta trocada para {0}.', { 0: r.installDir })); void qc.invalidateQueries(); } },
    onError: e => setNote(e.message),
  }));
  const achQ = useQuery(trpc.achievements.forGame.queryOptions({ id: inst?.id ?? '' }, { enabled: !!inst?.adapter }));
  const achs = inst?.adapter && achQ.data && (achQ.data.list.length || achQ.data.errors.length) ? achQ.data : null;
  const side = useRef<HTMLDivElement>(null);
  // De onde se entrou no painel de conquistas, para o Voltar levar de volta para lá.
  const sideFrom = useRef<Zone>('text');
  const opts: DOpt[] = [
    ...base.filter(o => !(achs && o.k === 'ach')),
    ...(inst && !inst.missing && !base.some(o => o.k === 'relink') ? [{ k: '__dir', l: tt('Trocar a pasta') }] : []),
    ...(inst && !inst.missing && inst.exe && /Windows|Linux/.test(navigator.userAgent) ? [{ k: '__lnk', l: tt('Atalho na Área de Trabalho') }] : []),
    ...(inst && !inst.missing && inst.exe && navigator.userAgent.includes('Linux') && /\.(exe|bat|cmd|lnk)$/i.test(inst.exe) ? [{ k: '__wine', l: tt('Opções do Wine') }] : []),
    ...(inst && !g.catalog ? [{ k: '__plat', l: tt('Trocar a plataforma') }] : []),
    ...(caps.length ? [{ k: '__shots', l: tt('Abrir pasta das capturas') }] : []),
    ...(g.console ? [{ k: '__cover', l: tt('Trocar a capa') }] : []),
    ...(g.console && art.custom ? [{ k: '__coverReset', l: tt('Voltar para a capa original') }] : []),
  ];
  // Desinstalado: só a ação principal aparece; o resto (mostrar a pasta, remover, GitHub…) fica em "Mais opções".
  const isMain = (o: DOpt, j: number) => j === 0 || (!inst?.missing && MAIN.has(o.k) && o.k !== 'remove');
  const main = opts.filter(isMain), rest = opts.filter((o, j) => !isMain(o, j));
  const shown: DOpt[] = rest.length > 1 ? [...main, { k: '__more', l: tt('Mais opções') }] : [...main, ...rest];
  const [more, setMore] = useState(false);
  const [wine, setWine] = useState(false);
  const [mi, setMi] = useState(0);
  const tone = score ? (score.value >= 75 ? 'hi' : score.value >= 50 ? 'mid' : 'lo') : '';
  const tops = [score ? 'score' : null, 'ttb'].filter((x): x is 'score' | 'ttb' => !!x);
  const [pi, setPi] = useState(0);
  const topNow = tops[Math.min(pi, tops.length - 1)];
  const openScore = () => { if (!score?.url) return; sfx.play('ok'); if (score.url.startsWith('https:')) openWeb(score.url, `${g.title} · ${score.by === 'IGDB' ? 'IGDB.com' : score.by}`); else window.open(score.url); };
  const openTtb = () => { sfx.play('ok'); openWeb(`https://howlongtobeat.com/?q=${encodeURIComponent(g.title)}`, `${g.title} · HowLongToBeat`); };
  const [zone, setZone] = useState<Zone>('acts');
  const [ai, setAi] = useState(0);
  const [si, setSi] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { setNote(null); setZone('acts'); setAi(0); setSi(0); setView(null); setMore(false); scroll.current?.scrollTo({ top: 0 }); }, [g.key]);
  useEffect(() => { if (ai >= shown.length && shown.length) setAi(shown.length - 1); }, [shown.length]);
  useEffect(() => { if (zone === 'score' && !tops.length) setZone('acts'); if ((zone === 'meta' || zone === 'side') && !achs) setZone('acts'); }, [zone, tops.length, !!achs]);

  useEffect(() => {
    const el = scroll.current; if (!el) return;
    if (zone === 'acts' || zone === 'score' || zone === 'meta') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (zone === 'shots') el.querySelector('.gv-shots')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (zone === 'side') el.querySelector('.gv-duo')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.querySelector('.gv-text')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [zone]);
  useEffect(() => { strip.current?.children[si]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [si]);
  useEffect(() => { if (more) scroll.current?.querySelector('.gv-menu .on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [more, mi]);

  const mv = (f: () => void) => { sfx.play('move'); f(); };
  const goSide = (from: Zone) => { sfx.play('ok'); sideFrom.current = from; setZone('side'); };
  const runOpt = (o: DOpt | undefined) => { if (!o) return; setMore(false); if (o.k === '__lnk') { sfx.play('ok'); lnk.mutate({ id: inst!.id }); } else if (o.k === '__wine') { sfx.play('ok'); setWine(true); } else if (o.k === '__dir') { sfx.play('ok'); dir.mutate({ id: inst!.id }); } else if (o.k === '__plat') { sfx.play('ok'); plat.mutate({ id: inst!.id }); } else if (o.k === '__shots') { sfx.play('ok'); openShots.mutate({ title: g.title }); } else if (o.k === '__cover') changeCover(); else if (o.k === '__coverReset') { sfx.play('ok'); resetCover.mutate({ console: g.console!, title: g.title }); } else run(o.k, g); };
  const act = (j: number) => { const o = shown[j]; if (o?.k === '__more') { sfx.play(more ? 'back' : 'ok'); setMi(0); setMore(!more); } else runOpt(o); };

  useKeys((k: Key) => {
    if (wine) return;
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    if (view != null) {
      if (k === 'X' && view < caps.length) return askDrop(view);
      if (k === 'Escape' || k === 'Enter') { sfx.play('back'); setView(null); }
      else if (R && view < shots.length - 1) mv(() => setView(view + 1));
      else if (L && view > 0) mv(() => setView(view - 1));
      return;
    }
    if (more) {
      if (k === 'Enter') { sfx.play('ok'); return runOpt(rest[mi]); }
      if (D && mi < rest.length - 1) mv(() => setMi(mi + 1));
      else if (U && mi > 0) mv(() => setMi(mi - 1));
      else if (k === 'Escape' || L || R || (U && mi === 0)) { sfx.play('back'); setMore(false); }
      return;
    }
    if (zone === 'meta') {
      if (k === 'Enter') return goSide('meta');
      if (D || k === 'Escape') mv(() => setZone(tops.length ? 'score' : 'acts'));
      return;
    }
    if (zone === 'score') {
      if (k === 'Enter') return topNow === 'ttb' ? openTtb() : openScore();
      if (R && pi < tops.length - 1) mv(() => setPi(pi + 1));
      else if (L && pi > 0) mv(() => setPi(pi - 1));
      else if (U && achs) mv(() => setZone('meta'));
      else if (D || k === 'Escape') mv(() => setZone('acts'));
      return;
    }
    if (zone === 'side') {
      const el = side.current;
      if (D || k === 'RT') { sfx.play('move'); el?.scrollBy({ top: k === 'RT' ? 600 : 140, behavior: 'smooth' }); }
      else if (U || k === 'LT') { sfx.play('move'); el?.scrollBy({ top: k === 'LT' ? -600 : -140, behavior: 'smooth' }); }
      else if (L || k === 'Escape') mv(() => setZone(sideFrom.current));
      return;
    }
    if (k === 'Escape') { sfx.play('back'); return onBack(); }
    if (zone === 'acts') {
      if (k === 'Enter') return act(ai);
      if (R && ai < shown.length - 1) mv(() => setAi(ai + 1));
      else if (L && ai > 0) mv(() => setAi(ai - 1));
      else if (U && tops.length) mv(() => { setPi(0); setZone('score'); });
      else if (U && achs) mv(() => setZone('meta'));
      else if (D) mv(() => setZone(shots.length ? 'shots' : 'text'));
      return;
    }
    if (zone === 'shots') {
      if (k === 'Enter') { sfx.play('ok'); return setView(si); }
      if (k === 'X' && si < caps.length) return askDrop(si);
      if (R && si < shots.length - 1) mv(() => setSi(si + 1));
      else if (L && si > 0) mv(() => setSi(si - 1));
      else if (U) mv(() => setZone('acts'));
      else if (D) mv(() => setZone('text'));
      return;
    }
    const el = scroll.current;
    if (R && achs) { sideFrom.current = 'text'; return mv(() => setZone('side')); }
    if (D || k === 'RT') { sfx.play('move'); el?.scrollBy({ top: k === 'RT' ? 600 : 160, behavior: 'smooth' }); }
    else if (U || k === 'LT') {
      if (!el || el.scrollTop <= el.querySelector<HTMLElement>('.gv-text')!.offsetTop - 40) mv(() => setZone(shots.length ? 'shots' : 'acts'));
      else { sfx.play('move'); el.scrollBy({ top: k === 'LT' ? -600 : -160, behavior: 'smooth' }); }
    }
  });

  const bg = art.fanart ?? art.cover ?? g.coverUrl;
  const meta = [g.catalog?.developer || info?.developer, g.catalog?.year || info?.year, g.platformName].filter(Boolean).join(' · ');
  const hint = (a: Parameters<typeof Glyph>[0]['a'], t: string): ReactNode => <span key={a + t}><Glyph a={a} />{t}</span>;

  return (
    <div className={`dsc gv ${theme} ${achs ? 'has-side' : ''}`}>
      <div className={`gv-bg ${art.fanart ? '' : 'soft'}`}>{bg && <img src={bg} alt="" />}</div>
      <div className="gv-scroll" ref={scroll}>
        <div className="gv-hero">
          <span className="gv-cover" role="button" tabIndex={-1} title={tt('Trocar a capa')} onClick={changeCover}><GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant="cover" done={!!inst?.achievements?.complete} />{g.console && <span className="gv-cover-edit">{tt('Trocar a capa')}</span>}</span>
          <div className="gv-head">
            {logo && art.logo ? <img className="gv-logo" src={art.logo} alt={g.title} /> : <h1>{g.title}</h1>}
            {(meta || achs) && <div className="gv-metarow">{meta && <p className="gv-meta">{meta}</p>}
              {achs && <button className={`gv-achpill ${zone === 'meta' ? 'on' : ''} ${inst?.achievements?.complete ? 'done' : ''}`} onClick={() => goSide('meta')}>
                <span className="gv-achpill-ic">{inst?.achievements?.complete ? '🏆' : '★'}</span>{inst?.achievements?.complete ? tt('100% · {0} conquistas', { 0: achs.list.length }) : achs.complete ? tt('{0}/{1} conquistas', { 0: achs.list.filter(a => a.unlockedAt != null).length, 1: achs.list.length }) : tt('{0} conquistas', { 0: achs.list.filter(a => a.unlockedAt != null).length })}</button>}</div>}
            <div className="gv-pills">
              {score && (
                <span className={`pill score ${tone} ${zone === 'score' && topNow === 'score' ? 'on' : ''}`} onClick={openScore}>
                  {score.value}
                  <span className="gv-pop">
                    <b>{score.by === 'IGDB' ? tt('Média da crítica') : tt('Nota do {0}', { 0: score.by })}</b>
                    <span>{score.platform ? tt('Versão de {0}', { 0: score.platform }) : tt('Média da crítica especializada')}</span>
                    <small>{tt('Fonte: {0}{1}', { 0: score.via === 'Steam' ? tt('loja da Steam') : score.via === 'IGDB' ? 'IGDB.com' : tt('Wikidata'), 1: score.url ? tt(' · OK ou clique abre a página aqui no Cosmo') : '' })}</small>
                  </span>
                </span>
              )}
              <span className={`pill ttb ${ttbMain ? '' : 'ask'} ${zone === 'score' && topNow === 'ttb' ? 'on' : ''}`} onClick={openTtb}>
                {ttbMain ? `${ttbMain[0]}: ${hrs(ttbMain[1])}` : tt('Ver tempo para zerar')}
                <span className="gv-pop">
                  <b>{tt('Tempo para zerar')}</b>
                  {ttb?.h ? <span>{tt('Campanha: {0}', { 0: hrs(ttb.h) })}</span> : null}
                  {ttb?.n ? <span>{tt('Campanha com extras: {0}', { 0: hrs(ttb.n) })}</span> : null}
                  {ttb?.c ? <span>100%: {hrs(ttb.c)}</span> : null}
                  {!ttbMain && <span>{tt('Ainda sem uma média confiável no IGDB.com.')}</span>}
                  <small>{tt('{0}OK ou clique abre o HowLongToBeat aqui no Cosmo', { 0: ttbMain ? tt('Média de jogadores no IGDB.com · ') : '' })}</small>
                </span>
              </span>
              {g.status && <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
              {g.isNew && <span className="pill new">{tt('Novo no catálogo')}</span>}
              {inst?.uninstalled && <span className="pill">{inst.playMs ? tt('Não instalado · {0} jogadas', { 0: fmtPlay(inst.playMs) }) : tt('Não instalado')}</span>}
              {inst && !inst.missing && <span className="pill inst">{inst.running ? tt('Jogando agora') : inst.playMs ? tt('{0} jogadas', { 0: fmtPlay(inst.playMs) }) : (inst.achievements?.unlocked ? tt('Instalado') : tt('Instalado · ainda não jogado'))}</span>}
              {!achs && inst?.achievements?.total ? <span className="pill">{tt('{0}/{1} conquistas', { 0: inst.achievements.unlocked, 1: inst.achievements.total })}</span> : null}
              {g.update?.updateAvailable && !self && <span className="pill new">{tt('Versão {0} disponível', { 0: g.update.latest?.tag })}</span>}
            </div>
            {inst?.missing && <p className="gv-warn">{inst.uninstalled
              ? tt('Desinstalado. O tempo de jogo e as conquistas ficam guardados; se você instalar de novo, o Cosmo reconhece o jogo e continua de onde parou.')
              : tt('A pasta do jogo não foi encontrada em {0}.', { 0: inst.installDir })}</p>}
            {p && <div className="gv-prog"><span>{p.error ?? p.stage}</span>{!p.error && p.pct > 0 && p.pct < 1 && <i style={{ width: `${Math.round(p.pct * 100)}%` }} />}</div>}
            {note && <p className="gv-note">{note}</p>}
            <div className="gv-acts">{shown.map((o, j) => (
              <span key={o.k + j} className="gv-aw">
                <button className={`${j === 0 ? 'pri' : ''} ${o.k === '__more' ? 'more' : ''} ${zone === 'acts' && ai === j && !more ? 'on' : ''} ${o.k === '__more' && more ? 'open' : ''}`}
                  onClick={() => { if (zone === 'acts' && ai === j) act(j); else mv(() => { setZone('acts'); setAi(j); setMore(false); }); }}>
                  {o.icon}{o.l}{o.k === '__more' && <i className="gv-caret">▾</i>}
                </button>
                {o.k === '__more' && more && (
                  <span className="gv-menu">{rest.map((r, n) => (
                    <button key={r.k + n} className={mi === n ? 'on' : ''} onMouseEnter={() => setMi(n)} onClick={() => { sfx.play('ok'); runOpt(r); }}>{r.icon}{r.l}</button>
                  ))}</span>
                )}
              </span>
            ))}</div>
          </div>
        </div>
        <section className="gv-sec">
          <h3>{caps.length ? tt('Galeria') : tt('Imagens')}</h3>
          {shots.length ? <div className="gv-shots" ref={strip}>{shots.map((u, j) => (
            <button key={u} className={`${zone === 'shots' && si === j ? 'on' : ''} ${j < caps.length ? 'mine' : ''}`} onClick={() => { sfx.play('ok'); setZone('shots'); setSi(j); setView(j); }}><img src={u} alt="" /></button>
          ))}</div> : <p className="dim">{tt('Sem capturas de tela para este jogo.')}</p>}
        </section>
        <section className={`gv-sec gv-text ${zone === 'text' ? 'on' : ''}`}>
          <div>
            {aboutText && <><h3>{tt('Sobre')}</h3><p>{aboutText}</p></>}
            {needs.text && <><h3>{tt('O que você precisa')}</h3><p>{needs.text}</p></>}
            {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
            {!aboutText && !needs.text && <p className="dim">{tt('Ainda não há descrição deste jogo.')}</p>}
            {(about.auto || needs.auto) && <small>{tt('Traduzido automaticamente do inglês')}</small>}
          </div>
        </section>
        {inst && (achs ? (
          <section className="gv-sec gv-duo">
            <h3>{tt('Tempo de jogo')}</h3>
            <div className="gv-duo-row">
              <GameTime id={inst.id} bare />
              <div className={`gv-side ${zone === 'side' ? 'on' : ''}`} ref={side} onClick={() => { if (zone !== 'side') mv(() => setZone('side')); }}><GameAchievements d={achs} /></div>
            </div>
          </section>
        ) : <GameTime id={inst.id} />)}
        {extra && <section className="gv-sec gv-extra">{extra}</section>}
      </div>
      <div className="dsc-ft">
        {view != null ? [hint('lr', tt('Imagem')), ...(view < caps.length ? [hint('x', tt('Excluir captura'))] : []), hint('back', tt('Fechar'))]
          : more ? [hint('ud', tt('Escolher')), hint('ok', rest[mi]?.l ?? 'OK'), hint('back', tt('Fechar'))]
          : zone === 'score' ? [hint('ok', topNow === 'ttb' ? tt('Abrir o HowLongToBeat') : tt('Abrir a página')), ...(tops.length > 1 ? [hint('lr', tt('Escolher'))] : []), hint('ud', tt('Ações')), hint('back', tt('Voltar'))]
          : zone === 'meta' ? [hint('ok', tt('Ver as conquistas')), hint('ud', tops.length ? tt('Nota e ações') : tt('Ações')), hint('back', tt('Voltar'))]
          : zone === 'side' ? [hint('ud', tt('Rolar as conquistas')), hint('back', tt('Voltar'))]
          : zone === 'acts' ? [hint('ok', shown[ai]?.l ?? 'OK'), hint('lr', tt('Ações')), hint('ud', tops.length ? tt('Nota, imagens e texto') : tt('Imagens e texto')), hint('back', tt('Voltar'))]
          : zone === 'shots' ? [hint('ok', tt('Ampliar')), hint('lr', tt('Imagens')), ...(si < caps.length ? [hint('x', tt('Excluir captura'))] : []), hint('ud', tt('Rolar')), hint('back', tt('Voltar'))]
          : [hint('ud', tt('Rolar')), ...(achs ? [hint('lr', tt('Conquistas'))] : []), hint('back', tt('Voltar'))]}
      </div>
      {view != null && shots[view] && (
        <div className="gv-view" onClick={() => setView(null)}><img src={shots[view]} alt="" /><span>{view < caps.length ? tt('Sua captura · ') : ''}{view + 1} / {shots.length}</span></div>
      )}
      {wine && inst && <WineDialog id={inst.id} title={g.title} onClose={() => setWine(false)} />}
    </div>
  );
}

function GameTime({ id, bare = false }: { id: string; bare?: boolean }) {
  const st = useQuery(useTRPC().play.stats.queryOptions({ id }));
  const d = st.data;
  if (!d) return null;
  const max = Math.max(...d.days, 0.01), week = d.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
  return (
    <Box className={bare ? 'gv-time' : 'gv-sec gv-time'}>
      {!bare && <h3>{tt('Tempo de jogo')}</h3>}
      {d.sessions ? <>
        <div className="gv-bigs">
          <div><b>{fmtPlay(d.totalMs) || '0m'}</b><span>{tt('tempo total')}</span></div>
          <div><b>{d.lastPlayed ? ago(d.lastPlayed) : '—'}</b><span>{tt('última vez')}</span></div>
          <div><b>{d.sessions}</b><span>{tt('sessões')}</span></div>
          <div><b>{d.avgMs ? fmtPlay(d.avgMs) : '—'}</b><span>{tt('por sessão')}</span></div>
        </div>
        <div className="gv-chart">
          <div className="gv-b14">{d.days.map((v, i) => <i key={i} className={v ? '' : 'z'} title={v ? fmtPlay(v * 3600_000) : ''} style={{ height: `${v ? Math.max(4, (v / max) * 100) : 2}%` }} />)}</div>
          <div className="gv-ax"><span>{tt('14 dias atrás')}</span><span>{tt('{0} nesta semana', { 0: fmtPlay(week) || '0m' })}</span><span>{tt('hoje')}</span></div>
        </div>
      </> : <p className="dim">{tt('Conta a partir da primeira vez que você jogar pelo Cosmo.')}</p>}
    </Box>
  );
}
const Box = ({ className, children }: { className: string; children: ReactNode }) => (className.includes('gv-sec') ? <section className={className}>{children}</section> : <div className={className}>{children}</div>);

function GameAchievements({ d }: { d: GameAchievementsData }) {
  const got = d.list.filter(a => a.unlockedAt != null).sort((a, b) => b.unlockedAt! - a.unlockedAt!), locked = d.list.filter(a => a.unlockedAt == null);
  const pct = d.list.length ? Math.round((got.length / d.list.length) * 100) : 0;
  const row = (a: GameAchievementsData['list'][number]) => (
    <div key={a.id} className={`gv-ach ${a.unlockedAt == null ? 'off' : ''}`}>
      <span className="gv-achic">{a.icon ? <img src={a.icon} alt="" loading="lazy" /> : <i>★</i>}</span>
      <span className="gv-acht"><b>{a.name}</b>{a.description && <span>{a.description}</span>}{(a.unlockedAt != null || a.rarity != null) && <small>{[a.unlockedAt != null ? fmtDay(a.unlockedAt) : null, a.points ? String(a.points) : null].filter(Boolean).join(' · ')}{a.rarity != null && <em className={isRare(a.rarity) ? 'rare' : ''}>{a.unlockedAt != null ? ' · ' : ''}{tt('{0}% dos jogadores', { 0: fmtPct(a.rarity) })}</em>}</small>}</span>
    </div>
  );
  return (
    <>
      <div className="gv-sidehd">
        <h3>{tt('Conquistas')}</h3>
        {d.complete ? <>
          <div className="gv-achsum"><b>{got.length}</b><span>{tt('de {0}', { 0: d.list.length })}</span><em>{pct}%</em></div>
          {d.list.length > 0 && <div className="gv-achbar"><i style={{ width: `${pct}%` }} /></div>}
        </> : <div className="gv-achsum"><b>{got.length}</b><span>{got.length === 1 ? tt('desbloqueada') : tt('desbloqueadas')}</span></div>}
      </div>
      {d.errors.map(e => <p key={e} className="gv-sidenote">{e}</p>)}
      {got.length > 0 && <><h4>{tt('Desbloqueadas')}</h4>{got.map(row)}</>}
      {locked.length > 0 && <><h4>{tt('Bloqueadas · {0}', { 0: locked.length })}</h4>{locked.map(row)}</>}
      {d.origin && <small className="gv-achsrc">{tt('Fonte: {0}', { 0: d.origin })}</small>}
    </>
  );
}
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
