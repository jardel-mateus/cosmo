import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { semArquivos, tileClick } from '@shared/gameclick';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, PlayStats, RadarEvent } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, reduceMotion, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural, locale } from '../lib/format';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { useTranslated } from '../lib/translate';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useDeviceStatus, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useFeed, useGameProgress, useHubActions, useHubData, type HubGame, uninstallMsg } from './data';
import { wheelNav } from './wheel';
import { tt } from '@shared/i18n';

type Cat = 'games' | 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type Kind = 'game' | 'search' | 'disc' | 'empty' | 'ach' | 'sum' | 'time' | 'theme' | 'dir' | 'snd' | 'radar' | 'off';
type Tag = 'new' | 'upd' | 'up';
interface It { key: string; kind: Kind; g?: HubGame; ic?: IconName; t: string; s: string; tag?: Tag; f?: RadarEvent }
type Zone = 'gacts' | 'gshots' | 'gtext';
interface St { ci: number; ii: number[]; opt: boolean; oi: number; list: boolean; li: number; dir: 'up' | 'down'; game: string | null; zone: Zone; ai: number; gs: number }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const CATS: [Cat, string, IconName][] = [
  ['games', tt('Jogos'), 'pad'], ['cat', tt('Descobrir'), 'compass'], ['news', tt('Novidades'), 'bell'],
  ['ach', tt('Conquistas'), 'medal'], ['time', tt('Tempo de jogo'), 'clock'], ['cfg', tt('Ajustes'), 'gear'],
];
const THEMES: [string, number, boolean?][] = [[tt('Violeta'), 255], [tt('Azul'), 215], [tt('Verde-água'), 175], [tt('Vinho'), 335], [tt('Âmbar'), 30], [tt('Grafite'), 240, true]];
const TAGS = { new: tt('Novo'), upd: tt('Versão nova'), up: tt('Mudou de status') } as const;
const FEED = { new: tt('Novo no catálogo'), upd: tt('Versão nova'), up: tt('Mudou de status') } as const;
const W = 1920, H = 1080;
const waveY = (x: number) => 600 + Math.sin(x / 420 + 0.6) * 46;
const TEXT_TOP = Math.round(waveY(420) - 160);
const SEC_GAP = 60;
function place(d: number): [number, number, number] {
  if (d === 0) return [300, waveY(420) - 120, 1];
  const x = d < 0 ? 300 + d * 190 - 40 : 1240 + (d - 1) * 190;
  return [x, waveY(x + 70) - 60, 0.52];
}

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} done={!!g.installed?.achievements?.complete} />;

function Waves({ psp }: { psp: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return;
    const x = cvs.getContext('2d'); if (!x) return;
    cvs.width = W; cvs.height = H;
    if (psp) {
      const still = reduceMotion();
      const yA = (px: number, t: number) => H * 0.64 + Math.sin(px / 560 + t * 0.16 + 0.8) * 95 + Math.sin(px / 230 + t * 0.27) * 16;
      const yB = (px: number, t: number) => H * 0.72 + Math.sin(px / 470 - t * 0.12 + 2.1) * 70 + Math.sin(px / 190 + t * 0.2) * 12;
      const fill = (f: (px: number, t: number) => number, t: number, g: CanvasGradient) => {
        x.beginPath(); x.moveTo(0, H);
        for (let px = 0; px <= W; px += 12) x.lineTo(px, f(px, t));
        x.lineTo(W, H); x.closePath(); x.fillStyle = g; x.fill();
      };
      let raf = 0;
      const frame = (ms: number) => {
        const t = ms / 1000;
        x.clearRect(0, 0, W, H);
        let g = x.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, 'rgba(110,225,255,.55)'); g.addColorStop(1, 'rgba(70,235,255,.9)'); fill(yA, t, g);
        g = x.createLinearGradient(0, H * 0.6, 0, H); g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(255,255,255,.05)'); fill(yB, t, g);
        x.beginPath();
        for (let px = 0; px <= W; px += 10) { const y = yA(px, t); if (px) x.lineTo(px, y); else x.moveTo(px, y); }
        x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3; x.shadowColor = 'rgba(255,255,255,.8)'; x.shadowBlur = 18; x.stroke(); x.shadowBlur = 0;
        if (!still) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }
    const P = Array.from({ length: 150 }, () => ({ x: Math.random() * W, o: (Math.random() - 0.5) * 220, v: 8 + Math.random() * 26, r: 0.6 + Math.random() * 2.2, p: Math.random() * 6 }));
    const still = reduceMotion();
    const band = (t: number, k: number) => (px: number) => waveY(px) + 40 + Math.sin(px / (300 + k * 90) + t * (0.18 + k * 0.05) + k * 1.7) * (70 - k * 10) + Math.sin(px / 140 + t * 0.4 + k) * 10;
    let raf = 0;
    const frame = (ms: number) => {
      const t = ms / 1000;
      x.clearRect(0, 0, W, H);
      for (let k = 0; k < 4; k++) {
        const a = band(t, k), b = band(t * 1.1 + 2, k + 0.5);
        x.beginPath();
        for (let px = 0; px <= W; px += 16) x.lineTo(px, a(px));
        for (let px = W; px >= 0; px -= 16) x.lineTo(px, b(px) + 30 + k * 12);
        const gr = x.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, `rgba(255,255,255,${0.07 + k * 0.02})`); gr.addColorStop(1, `rgba(255,255,255,${0.03 + k * 0.01})`);
        x.fillStyle = gr; x.fill();
      }
      for (let k = 0; k < 7; k++) {
        const f = band(t * (1 + k * 0.07), k * 0.6);
        x.beginPath(); x.strokeStyle = `rgba(255,255,255,${0.12 + (k % 3) * 0.1})`; x.lineWidth = k % 3 === 0 ? 2 : 1;
        for (let px = 0; px <= W; px += 12) { const y = f(px) + k * 7; if (px) x.lineTo(px, y); else x.moveTo(px, y); }
        x.stroke();
      }
      const base = band(t, 1);
      for (const p of P) {
        if (!still) p.x = (p.x + p.v / 60) % W;
        const y = base(p.x) + p.o * (0.4 + 0.6 * Math.abs(Math.sin(p.x / 500)));
        x.beginPath(); x.fillStyle = `rgba(255,255,255,${0.25 + 0.55 * Math.abs(Math.sin(t * 1.4 + p.p))})`; x.arc(p.x, y, p.r, 0, 7); x.fill();
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [psp]);
  return <canvas ref={ref} className="p3-cv" />;
}

export function PS3Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const psp = id === 'psp';
  const dev = useDeviceStatus();
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ ci: tab === 'cat' ? 1 : 0, ii: CATS.map(() => 0), opt: false, oi: 0, list: false, li: 0, dir: 'down', game: null, zone: 'gacts', ai: 0, gs: 0 }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show(tt('Pasta dos jogos alterada')); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('soft'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const [dst, setDst] = useState(initialDiscover);
  const [disc, setDisc] = useState(tab === 'cat');
  const focusSearch = () => { setDisc(true); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, game: null, opt: false, list: false, dir: x.ci > 1 ? 'up' : 'down', ci: 1, ii: x.ii.map((v, i) => (i === 1 ? 0 : v)) })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; set(x => ({ ...x, ii: x.ii.map((v, j) => (j === 0 ? i : v)) })); openGame(lib[i]!); }
  }, [game0, lib.length]);
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const feedGame = (f: RadarEvent) => data.catalog.find(y => y.catalog?.id === f.gameId) ?? null;
  const found = useMemo(() => query.trim() ? [...data.catalog, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : data.catalog, [data.catalog, data.lib, query]);

  const playLine = (g: HubGame) => {
    const i = g.installed;
    if (!i) return g.isNew ? tt('Novo no catálogo · não instalado') : tt('Não instalado');
    if (i.missing) return i.uninstalled ? tt('Não instalado') : tt('Pasta do jogo não encontrada');
    if (i.running) return tt('Jogando agora');
    return i.playMs ? tt('{0} jogadas', { 0: fmtPlay(i.playMs) }) + (i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : '') : tt('Ainda não jogado');
  };
  const itemsOf = (k: Cat): It[] => {
    let L: It[] = [];
    if (k === 'games') {
      L = lib.map(g => ({ key: g.key, kind: 'game', g, t: g.title, s: playLine(g), tag: g.update?.updateAvailable && !self ? 'upd' : g.isNew ? 'new' : undefined }));
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'compass', t: tt('Nenhum jogo instalado'), s: data.catalog.length ? tt('{0} de {1} em Descobrir', { 0: plural(data.catalog.length, tt('recomp'), tt('recomps')), 1: c.name }) : tt('Ainda não há recomps de {0} no catálogo', { 0: c.name }) }];
    }
    if (k === 'cat') {
      L = [{ key: 'disc', kind: 'disc', ic: 'compass', t: tt('Explorar o catálogo'), s: tt('{0} · destaques, filtros e busca', { 0: plural(data.catalog.length, tt('jogo'), tt('jogos')) }) },
        { key: 'search', kind: 'disc', ic: 'search', t: tt('Buscar'), s: tt('Procure um jogo pelo nome, estúdio ou ano') },
        ...data.catalog.filter(x => x.isNew).slice(0, 8).map(g => ({ key: g.key, kind: 'game' as Kind, g, t: g.title, s: tt('Novo no catálogo{0}', { 0: g.status ? ` · ${STATUS_LABEL[g.status]}` : '' }), tag: 'new' as Tag }))];
    }
    if (k === 'news') {
      L = data.feed.map(f => { const g = feedGame(f); return { key: String(f.id), f, kind: 'game' as Kind, g: g ?? undefined, ic: 'bell' as IconName, t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''} · ${ago(f.at)}`, tag: f.kind }; });
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'bell', t: tt('Nada novo por aqui'), s: tt('O Cosmo confere o Recompendium toda vez que abre') }];
    }
    if (k === 'ach') {
      L = lib.map(g => { const a = g.installed?.achievements; return { key: g.key, kind: 'ach' as Kind, g, t: g.title, s: a?.total ? tt('{0}/{1} conquistas · {2}%', { 0: a.unlocked, 1: a.total, 2: Math.round((a.unlocked / a.total) * 100) }) : g.installed?.adapter ? tt('Nenhuma conquista ainda') : tt('O Cosmo ainda não lê as conquistas deste port') }; });
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'medal', t: tt('Nenhum jogo instalado'), s: tt('As conquistas aparecem aqui quando você instalar ou adicionar um jogo') }];
    }
    if (k === 'time') {
      const tot = lib.reduce((a, g) => a + (g.installed?.playMs ?? 0), 0);
      L = lib.length ? [{ key: 'sum', kind: 'sum', ic: 'chart', t: tt('Resumo'), s: tt('{0} neste console · {1}', { 0: fmtPlay(tot) || '0m', 1: plural(lib.length, tt('jogo'), tt('jogos')) }) },
        ...byPlay.map(g => ({ key: g.key, kind: 'time' as Kind, g, t: g.title, s: playLine(g) }))]
        : [{ key: 'empty', kind: 'empty', ic: 'clock', t: tt('Nenhuma sessão ainda'), s: tt('O tempo começa a contar quando você abre um jogo por aqui') }];
    }
    if (k === 'cfg') L = [
      { key: 'theme', kind: 'theme', ic: 'star', t: tt('Tema de cor'), s: THEMES[themeIdx]![0] },
      { key: 'dir', kind: 'dir', ic: 'folder', t: tt('Pasta dos jogos'), s: tt('Onde o Cosmo instala o que você baixa') },
      { key: 'snd', kind: 'snd', ic: 'sound', t: tt('Sons da interface'), s: s.snd ? tt('Ligados') : tt('Desligados') },
      { key: 'radar', kind: 'radar', ic: 'bell', t: tt('Radar de novidades'), s: tt('Confere o catálogo toda vez que o Cosmo abre') },
      { key: 'off', kind: 'off', ic: 'power', t: tt('Voltar ao Cosmo'), s: tt('Desliga este console') },
    ];
    return L;
  };
  const cat = CATS[st.ci]![0];
  const themeIdx = (s.xmbTheme[id] ?? (psp ? 1 : 0)) % THEMES.length;
  const items = itemsOf(cat);
  const sel = Math.min(st.ii[st.ci] ?? 0, items.length - 1);
  const it = items[sel]!;
  // Jogos: um vão com um traço separa os jogados recentemente da coleção na fita.
  const split = cat === 'games' && data.recent < items.length ? data.recent : 0;
  const placeAt = (i: number): [number, number, number] => {
    const d = i - sel, [px, py, sc] = place(d);
    if (!split) return [px, py, sc];
    const x = d > 0 && i >= split && sel < split ? px + SEC_GAP : d < 0 && i < split && sel >= split ? px - SEC_GAP : px;
    return [x, x === px ? py : waveY(x + 70) - 60, sc];
  };
  const divider = (() => {
    if (!split) return null;
    const right = sel < split, d = (right ? split : split - 1) - sel;
    if (d > 4 || d < -2) return null;
    const [x, y] = placeAt(right ? split : split - 1);
    return { x: right ? x - 5 : x + 212, y: y + 60, right };
  })();
  const g = it.g ?? null;
  const feed = useFeed(data.feed, cat === 'news' && !st.game);

  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: g?.installed?.id ?? '' }, { enabled: cat === 'ach' && !!g?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];
  const statQ = useQueries({ queries: (cat === 'time' || cat === 'games' ? lib : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(lib.map((x, i) => [x.key, statQ[i]?.data] as const));

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
  const goCat = (ci: number, ii?: number) => {
    if (ci === st.ci && ii == null) return;
    sfx.play('move');
    set(x => ({ ...x, dir: ci > x.ci ? 'down' : 'up', ci, opt: false, list: false, li: 0, ii: ii == null ? x.ii : x.ii.map((v, j) => (j === ci ? ii : v)) }));
  };
  const openGame = (x: HubGame) => { up({ game: x.key, opt: false, zone: 'gacts', ai: 0, gs: 0 }); };
  const openPage = (x: HubGame) => { sfx.play('ok'); up({ opt: false }); openGame(x); };

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
    if (k === 'uninstall') { void act.uninstall(x).then(r => { if (!r) return; up({ game: null }); show(uninstallMsg(r, x.title)); }); return; }
    if (k === 'remove') { void act.remove(x).then(ok => { if (!ok) return; up({ game: null }); show(tt('{0} saiu da biblioteca', { 0: x.title })); }); return; }
    if (k === 'update') { act.update(x); return show(tt('Atualizando para {0}… configurações e saves ficam', { 0: x.update?.latest?.tag })); }
    if (k === 'ach') { up({ game: null }); return goCat(3, Math.max(0, lib.indexOf(x))); }
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
  };

  const enter = () => {
    if (st.opt && g) { const o = options(g)[st.oi]; if (o) run(o.k, g); return; }
    switch (it.kind) {
      case 'game': if (it.f) { feed.done(it.f); if (g) { sfx.play('ok'); openGame(g); } return; } if (g && semArquivos(g)) return openPage(g); if (g) run(primaryOf(g).k, g); return;
      case 'search': sfx.play('ok'); searchRef.current?.focus(); return;
      case 'disc': sfx.play('ok'); if (it.key === 'search') focusSearch(); else setDisc(true); return;
      case 'empty': if (cat === 'games' && data.catalog.length) goCat(1); return;
      case 'ach': if (achList.length) { sfx.play('ok'); up({ list: !st.list, li: 0 }); } return;
      case 'time': if (g) { sfx.play('ok'); openGame(g); } return;
      case 'theme': sfx.play('ok'); return setSettings({ xmbTheme: { ...getSettings().xmbTheme, [id]: (themeIdx + 1) % THEMES.length } });
      case 'dir': sfx.play('ok'); return pickDir.mutate();
      case 'snd': sfx.play('ok'); return setSettings({ snd: !getSettings().snd });
      case 'radar': sfx.play('ok'); return show(tt('O radar confere o catálogo do Recompendium toda vez que o Cosmo abre'));
      case 'off': sfx.play('back'); return onBack();
    }
  };
  const back = () => {
    sfx.play('back');
    if (game) return up({ game: null });
    if (st.opt) return up({ opt: false });
    if (st.list) return up({ list: false });
    if (query && cat === 'cat') { setQuery(''); return; }
    onBack();
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (st.opt && g) {
      const n = options(g).length;
      if (D && st.oi < n - 1) mv({ oi: st.oi + 1 }); else if (U && st.oi > 0) mv({ oi: st.oi - 1 });
      return;
    }
    if (st.list) {
      if (D && st.li < achList.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 });
      return;
    }
    if (cat === 'news' && (k === 'X' || k === 'Y')) { if (k === 'X') feed.drop(it.f); else void feed.clear(); return; }
    if (k === 'X' || k === 'Y') { if (g && it.kind !== 'ach') { sfx.play('ok'); up({ opt: true, oi: 0 }); } return; }
    if (R && sel < items.length - 1) return mv({ ii: st.ii.map((v, j) => (j === st.ci ? sel + 1 : v)) });
    if (L && sel > 0) return mv({ ii: st.ii.map((v, j) => (j === st.ci ? sel - 1 : v)) });
    if ((D || k === 'RB' || k === 'Tab') && st.ci < CATS.length - 1) return goCat(st.ci + 1);
    if ((U || k === 'LB') && st.ci > 0) return goCat(st.ci - 1);
  }, !(disc || game));

  const hints: Hint[] = st.opt || st.list ? [['ud', tt('Escolher')], ['ok', st.list ? tt('Fechar lista') : tt('Confirmar')], ['back', tt('Fechar')]]
    : cat === 'news' && it.f ? [['ok', tt('Ver jogo')], ['x', tt('Dispensar')], ['y', tt('Limpar tudo')], ['lr', tt('Item')], ['ud', tt('Categoria')], ['back', tt('Sair')]]
    : [['lr', tt('Item')], ['ud', tt('Categoria')], ['back', tt('Sair')]];
  const theme = THEMES[themeIdx]!;
  const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' });

  return (
    <section className="view hub sk-p3" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`p3 ${psp ? 'psp' : ''}`} style={{ ['--cc' as string]: c.color, ['--h' as string]: theme[1], filter: theme[2] ? 'saturate(.15)' : undefined }}>
        <div className={`p3-wv ${game ? 'dim' : ''}`}><Waves psp={psp} /></div>
        {disc && !game && (
          <Discover theme={`d-p3 ${psp ? 'psp' : ''}`} cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info').map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
            run={run} onOpen={openGame} onBack={() => setDisc(false)} />
        )}
        {disc && !game ? null : game ? (
          <GameView theme={`d-p3 ${psp ? 'psp' : ''}`} g={game} self={self} run={run} onBack={() => up({ game: null })}
            opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />
        ) : (
          <>
            <nav className="p3-cats">{CATS.map(([k, l, ic], i) => (
              <button key={k} className={i === st.ci ? 'on' : ''} onClick={() => goCat(i)}>
                <Ic n={ic} />{l}{k === 'news' && data.feed.length > 0 && <span className="n">{data.feed.length}</span>}
              </button>
            ))}</nav>
            {psp ? (
              <div className="p3-st psp">
                {data.feed.length > 0 && <span className="r"><i />{data.feed.length}</span>}
                <span>{date} {clock}</span>
                {dev.batt && <span className="bt"><Ic n="batt" /><i style={{ width: Math.round(dev.batt.level * 33) }} /></span>}
              </div>
            ) : (
              <div className="p3-st">
                <span className="av"><Ic n="pad" /></span><span>{tt('Cosmo')}</span>
                {data.feed.length > 0 && <span className="r"><i />{data.feed.length}</span>}
                <span className="sp" /><span>{date} {clock}</span>
              </div>
            )}
            <div className={`p3-rib in-${st.dir}`} key={cat} onWheel={wheelNav('h')}>
              {divider && <span className={`p3-sec ${divider.right ? 'r' : 'l'}`} style={{ transform: `translate(${divider.x}px, ${divider.y}px)` }}>
                {divider.right && <b>{tt('Coleção')}</b>}</span>}
              {items.map((x, i) => {
                const d = i - sel, [px, py, sc] = placeAt(i), on = d === 0;
                const off = cat === 'games' && x.g && !x.g.installed;
                return (
                  <button key={x.key} className={`p3-it ${on ? 'on' : ''} ${x.g?.installed?.missing ? 'missing' : ''}`} aria-label={x.t}
                    style={{ transform: `translate(${px}px, ${py}px) scale(${sc})`, opacity: d < -2 || d > 4 ? 0 : d < 0 ? 0.4 : on ? 1 : 0.8 }}
                    onClick={e => {
                      const sel1 = () => { if (!on) { sfx.play('move'); up({ opt: false, list: false, ii: st.ii.map((v, j) => (j === st.ci ? i : v)) }); } };
                      if (x.kind === 'game' && x.g && !x.f) return tileClick(e, x.g, { select: sel1, page: () => { sfx.play('ok'); openGame(x.g!); }, play: () => run('play', x.g!) });
                      if (on) enter(); else sel1();
                    }}>
                    <div className={`p3-gl ${x.g ? '' : 'icon'}`}>{x.g ? <Art g={x.g} v="square" /> : <Ic n={x.ic ?? 'info'} />}</div>
                    {off && <span className="dl"><Ic n="dl" /></span>}
                    {x.g?.installed?.running && <span className="dl run"><Ic n="play" /></span>}
                    {x.tag && <span className={`tg ${x.tag}`}>{TAGS[x.tag]}</span>}
                  </button>
                );
              })}
            </div>
            <div className="p3-tx" key={`${cat}-${it.key}`} style={{ top: TEXT_TOP }}>
              <h1>{it.t}</h1>
              <p>{it.s}</p>
              <Detail it={it} cat={cat} st={st} self={self} opts={g ? options(g) : []} primary={g ? primaryOf(g).l : ''}
                stats={g ? stats.get(g.key) : undefined} lib={byPlay} achList={achList} achLoading={ach.isLoading} theme={theme[0]} sndOn={s.snd}
                query={query} setQuery={setQuery} searchRef={searchRef}
                onSearchDone={() => { if (found.length) { sfx.play('move'); up({ ii: st.ii.map((v, j) => (j === 1 ? 1 : v)) }); } }}
                onOpt={j => { if (st.opt && st.oi === j) enter(); else { sfx.play('move'); up({ opt: true, oi: j }); } }} />
            </div>
          </>
        )}
        {!disc && !game && <div className="p3-hn">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>}
        {toast}
      </Fit>
      <BootOverlay kind="soft" label={c.name.toUpperCase()} />
    </section>
  );
}

function Bars({ d, week }: { d: number[]; week: number }) {
  const m = Math.max(...d, 0.01);
  return (
    <div className="p3-ch">
      <div className="b">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(4, (v / m) * 100) : 2}%` }} />)}</div>
      <div className="a"><span>{tt('14 dias atrás')}</span><span>{tt('{0} nesta semana', { 0: fmtPlay(week) || '0m' })}</span><span>{tt('hoje')}</span></div>
    </div>
  );
}

function Detail({ it, cat, st, self, opts, primary, stats, lib, achList, achLoading, theme, sndOn, query, setQuery, searchRef, onSearchDone, onOpt }: {
  it: It; cat: Cat; st: St; self: boolean; opts: Opt[]; primary: string;
  stats: PlayStats | undefined; lib: HubGame[]; achList: AchievementView[]; achLoading: boolean;
  theme: string; sndOn: boolean; query: string; setQuery: (v: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void; onOpt: (j: number) => void;
}) {
  const g = it.g;
  const needs = useTranslated(cat === 'cat' || cat === 'news' ? g?.catalog?.needs : undefined);
  const p = useGameProgress(g ?? null);
  if (it.kind === 'search') return (
    <>
      <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="p3-search" placeholder={tt('Nome do jogo…')} onDone={onSearchDone} />
      <div className="hint"><span><Glyph a="ok" />{tt('Digitar')}</span>{query && <span><Glyph a="back" />{tt('Limpar')}</span>}</div>
    </>
  );
  if (it.kind === 'game' && g) return (
    <>
      {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
      <div className="hint"><span><Glyph a="ok" />{primary}</span><span><Glyph a="x" />{tt('Opções')}</span></div>
      {st.opt ? (
        <div className="p3-opt">{opts.map((o, j) => <button key={o.k + j} className={j === st.oi ? 'on' : ''} onClick={() => onOpt(j)}><Ic n={o.ic} />{o.l}</button>)}</div>
      ) : g.installed && stats && cat === 'games' ? (
        <Bars d={stats.days} week={stats.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000} />
      ) : (cat === 'cat' || cat === 'news') ? (
        <dl className="p3-kv">
          {g.catalog?.developer && <><dt>{tt('Estúdio')}</dt><dd>{g.catalog.developer}{g.catalog.year ? ` · ${g.catalog.year}` : ''}</dd></>}
          <dt>{tt('Status')}</dt><dd>{g.status ? STATUS_LABEL[g.status] : '—'}</dd>
          {needs.text && <><dt>{tt('Precisa')}</dt><dd className="clamp">{needs.text}</dd></>}
          {self && !g.installed && <><dt>{tt('Instalação')}</dt><dd className="clamp">{SELF_INSTALL_NOTE}</dd></>}
        </dl>
      ) : null}
    </>
  );
  if (it.kind === 'ach' && g) {
    if (!g.installed?.adapter) return null;
    if (!achList.length) return <p className="dim">{achLoading ? tt('Lendo as conquistas…') : tt('Nenhuma conquista encontrada.')}</p>;
    const got = achList.filter(x => x.unlockedAt != null).length, off = Math.max(0, Math.min(st.li - 2, achList.length - 5));
    return (
      <>
        <div className="p3-pb"><i style={{ width: `${(got / achList.length) * 100}%` }} /></div>
        {!st.list && <div className="hint"><span><Glyph a="ok" />{tt('Ver lista')}</span></div>}
        <div className={`p3-al ${st.list ? 'open' : ''}`}>{achList.slice(off, off + 5).map((x, j) => (
          <div key={x.id} className={`p3-a ${st.list && off + j === st.li ? 'on' : ''} ${x.unlockedAt != null ? 'got' : 'lock'}`}>
            <span className="md">{x.icon ? <img src={x.icon} alt="" /> : <Ic n={x.unlockedAt != null ? 'medal' : 'lock'} />}</span>
            <span className="tx"><b>{x.name}</b><small>{x.description}</small></span>
            <span className="v">{x.unlockedAt != null ? fmtDate(x.unlockedAt) : tt('Bloqueada')}</span>
          </div>
        ))}</div>
      </>
    );
  }
  if (it.kind === 'time' && g) {
    if (!stats) return null;
    return (
      <>
        <dl className="p3-kv">
          <dt>{tt('Sessões')}</dt><dd>{stats.sessions}{stats.avgMs ? tt(' · {0} por sessão', { 0: fmtPlay(stats.avgMs) || '<1m' }) : ''}</dd>
        </dl>
        <Bars d={stats.days} week={stats.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000} />
        <div className="hint"><span><Glyph a="ok" />{tt('Página do jogo')}</span></div>
      </>
    );
  }
  if (it.kind === 'sum') {
    const mx = Math.max(...lib.map(x => x.installed?.playMs ?? 0), 1);
    return (
      <div className="p3-tl">{lib.slice(0, 6).map(x => (
        <div key={x.key}><span className="t">{x.title}</span><span className="bar"><i style={{ width: `${((x.installed?.playMs ?? 0) / mx) * 100}%` }} /></span><span className="v">{fmtPlay(x.installed?.playMs ?? 0) || '0m'}</span></div>
      ))}</div>
    );
  }
  if (it.kind === 'theme') return <div className="hint"><span><Glyph a="ok" />{tt('Trocar · {0}', { 0: theme })}</span></div>;
  if (it.kind === 'snd') return <div className="hint"><span><Glyph a="ok" />{sndOn ? tt('Desligar') : tt('Ligar')}</span></div>;
  if (it.kind === 'dir') return <><dl className="p3-kv"><dt>{tt('Pasta')}</dt><dd className="path"><PortsDir /></dd></dl><div className="hint"><span><Glyph a="ok" />{tt('Trocar pasta')}</span></div></>;
  if (it.kind === 'off') return <div className="hint"><span><Glyph a="ok" />{tt('Desligar')}</span></div>;
  if (it.kind === 'empty' && cat === 'games') return <div className="hint"><span><Glyph a="ok" />{tt('Abrir Descobrir')}</span></div>;
  return null;
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
