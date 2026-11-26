import { EventEmitter, on } from 'node:events';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, shell } from 'electron';
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import type { CompleteEvent, InstallProgress, LibrarySummary, PlayEvent, UnlockEvent } from '@shared/types';
import { CONSOLE_NAME } from '@shared/consoles';
import type { DB } from './db';
import { kvGet, kvSet } from './db';
import type { WebPane } from './web';
import { dismissRadar, listCatalog, listRadar, markRadarSeen, seeRadar, perConsole, platformCount, radarCounts, refreshCatalog, getExtraCatalogs } from './catalog';
import { loadSources, sourcesFile } from './sources';
import type { AchievementService } from './achievements/service';
import { ADAPTERS } from './achievements/adapters';
import type { Ports } from './ports/installer';
import { parseRepo } from './ports/github';
import type { Player } from './play';
import { installBuild, installUmu, installWinetricks, listVersions, remoteBuilds, removeBuild } from './wine/components';
import { loadConfig, readPatch, resetGame, writePatch } from './wine/config';
import { askBeforeDownload, deletePrefix, runLog, runWinetricks, setAskBeforeDownload, setDownloadAsker, wineStatus } from './wine/launch';
import { type Download, mergeConfig, VERB } from '@shared/wine';
import { prefixDir } from './steam';
import { planUninstall } from './uninstall';
import type { Artwork } from './artwork/service';
import type { GameInfoService } from './artwork/info';
import type { InGame } from './ingame';
import type { Translator } from './translate';
import type { WinCtl, WinState } from './window';
import type { Background } from './background';
import { logFile } from './log';
import type { Updater, UpdState } from './updater';
import { setLang, tt } from '@shared/i18n';
import { bindsFor, cleanBind, readAllBinds, sameBind } from '@shared/binds';

export interface RouterDeps { gog?: import('./gog').GogAccount; mainWindow?: () => BrowserWindow | null; db: DB; ach: AchievementService; ports: Ports; player: Player; art: Artwork; info?: GameInfoService; ingame?: InGame; web?: WebPane; tr: Translator; defaultPortsDir: string; win?: () => WinCtl | null; bg?: () => Background | null; upd?: () => Updater | null }
export const portsDirOf = (d: Pick<RouterDeps, 'db' | 'defaultPortsDir'>) => kvGet(d.db, 'portsDir') || d.defaultPortsDir;

export interface PickRequest { id: number; title: string; kind: 'dir' | 'exe' | 'img'; start: string; explicit: boolean }
const pickBus = new EventEmitter();
const pending = new Map<number, (v: string | null) => void>();
let pickSeq = 0;
const EXE = new Set(['.exe', '.bat', '.lnk', '.cmd', '.sh', '.appimage', '']);
const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function listDir(path: string, kind: 'dir' | 'exe' | 'img') {
  const out: { name: string; path: string; dir: boolean }[] = [];
  let names: string[] = [];
  try { names = readdirSync(path); } catch { return out; }
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('$')) continue;
    const full = join(path, name);
    let dir = false;
    try { dir = statSync(full).isDirectory(); } catch { continue; }
    if (dir) out.push({ name, path: full, dir: true });
    else if (kind === 'exe' && EXE.has(extname(name).toLowerCase()) && (process.platform === 'win32' ? extname(name) !== '' : true)) out.push({ name, path: full, dir: false });
    else if (kind === 'img' && IMG.has(extname(name).toLowerCase())) out.push({ name, path: full, dir: false });
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }));
}
function places() {
  const home = homedir();
  const L: { name: string; path: string }[] = [{ name: 'Pasta pessoal', path: home }];
  for (const [n, d] of [[tt('Área de Trabalho'), 'Desktop'], [tt('Downloads'), 'Downloads'], [tt('Documentos'), 'Documents'], [tt('Imagens'), 'Pictures'], [tt('Jogos'), 'Games']] as const) {
    const p = join(home, d); if (existsSync(p)) L.push({ name: n, path: p });
  }
  if (process.platform === 'win32') for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const p = `${c}:\\`; if (existsSync(p)) L.push({ name: `Disco ${c}:`, path: p }); }
  else L.push({ name: 'Raiz', path: '/' });
  return L;
}

async function nativePick(title: string, props: ('openDirectory' | 'openFile' | 'createDirectory')[], extra: Partial<Electron.OpenDialogOptions> = {}) {
  const win = BrowserWindow.getFocusedWindow();
  const opts: Electron.OpenDialogOptions = { title, properties: props, ...extra };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : res.filePaths[0] ?? null;
}

async function pick(title: string, props: ('openDirectory' | 'openFile' | 'createDirectory')[], extra: Partial<Electron.OpenDialogOptions> = {}) {
  if (!pickBus.listenerCount('pick')) return nativePick(title, props, extra);
  const id = ++pickSeq;
  const start = typeof extra.defaultPath === 'string' && existsSync(extra.defaultPath) ? extra.defaultPath : homedir();
  const res = await new Promise<string | null>(resolve => { pending.set(id, resolve); pickBus.emit('pick', { id, title, kind: !props.includes('openFile') ? 'dir' : extra.filters?.some(f => f.extensions.includes('png')) ? 'img' : 'exe', start, explicit: start !== homedir() } satisfies PickRequest); });
  return res === '\u0000native' ? nativePick(title, props, extra) : res;
}

export interface PlatformRequest { id: number; title: string; current: string | null }
const platBus = new EventEmitter();
const platPending = new Map<number, (v: string | null) => void>();
let platSeq = 0;

async function askPlatform(title: string, current: string | null) {
  if (!platBus.listenerCount('ask')) return null;
  const id = ++platSeq;
  return new Promise<string | null>(resolve => { platPending.set(id, resolve); platBus.emit('ask', { id, title, current } satisfies PlatformRequest); });
}

export interface DownloadRequest { id: number; title: string; items: Download[] }
const dlBus = new EventEmitter();
const dlPending = new Map<number, (v: boolean) => void>();
let dlSeq = 0;

const mb = (n: number | null) => (n ? ` (${Math.max(1, Math.round(n / 1048576))} MB)` : '');

async function nativeAskDownload(title: string, items: Download[]) {
  const opts: Electron.MessageBoxOptions = {
    type: 'question', buttons: [tt('Agora não'), tt('Baixar')], defaultId: 1, cancelId: 0,
    message: tt('O Cosmo precisa baixar algumas coisas para abrir {0}', { 0: title }),
    detail: items.map(d => `• ${d.name}${mb(d.size)}`).join('\n'),
  };
  const win = BrowserWindow.getFocusedWindow();
  return (win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)).response === 1;
}

function askDownload(title: string, items: Download[]) {
  if (!dlBus.listenerCount('ask')) return nativeAskDownload(title, items);
  const id = ++dlSeq;
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => { dlPending.delete(id); resolve(false); }, 10 * 60_000);
    dlPending.set(id, v => { clearTimeout(timer); resolve(v); });
    dlBus.emit('ask', { id, title, items } satisfies DownloadRequest);
  });
}

const t = initTRPC.create({ transformer: superjson, isServer: true });

export function createRouter(deps: RouterDeps) {
  const { db, ach, ports, player, art, tr } = deps;
  setDownloadAsker((title, items) => { deps.win?.()?.summon(); return askDownload(title, items); });
  const protectedDirs = () => {
    const P = (n: Parameters<typeof app.getPath>[0]) => { try { return app.getPath(n); } catch { return ''; } };
    return [homedir(), P('desktop'), P('documents'), P('downloads'), P('music'), P('pictures'), P('videos'), P('appData'), P('userData'), portsDirOf(deps),
      process.env.ProgramFiles ?? '', process.env['ProgramFiles(x86)'] ?? '', process.env.SystemRoot ?? ''].filter(Boolean);
  };
  const planFor = (id: string) => planUninstall(ach.getGame(id), ach.listGames(), protectedDirs());
  return t.router({
    art: t.router({
      get: t.procedure.input(z.object({ console: z.string(), platformName: z.string().nullish(), title: z.string() }))
        .query(({ input }) => art.get(input.console, input.platformName, [input.title])),
      shots: t.procedure.input(z.object({ console: z.string(), platformName: z.string().nullish(), title: z.string() }))
        .query(({ input }) => art.shots(input.console, input.platformName, [input.title])),
      info: t.procedure.input(z.object({ console: z.string(), platformName: z.string().nullish(), title: z.string(), id: z.string().nullish(), catalogId: z.string().nullish() }))
        .query(({ input }) => {
          let g: { installDir: string; exe: string | null } | null = null;
          if (input.id) { try { g = ach.getGame(input.id); } catch { g = null; } }
          return deps.info?.get({ console: input.console, platformName: input.platformName, title: input.title, installDir: g?.installDir, exe: g?.exe, catalogId: input.catalogId }) ?? null;
        }),
      status: t.procedure.query(() => art.status),
      refresh: t.procedure.mutation(() => art.refresh()),
      // Capa escolhida pelo jogador: abre a janela para escolher a imagem; false se cancelou.
      pickCover: t.procedure.input(z.object({ console: z.string(), title: z.string() })).mutation(async ({ input }) => {
        const file = await pick(tt('Escolha a nova capa de {0}', { 0: input.title }), ['openFile'], {
          defaultPath: app.getPath('pictures'), filters: [{ name: tt('Imagens'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
        });
        if (!file) return false;
        await art.setCover(input.console, input.title, file);
        return true;
      }),
      resetCover: t.procedure.input(z.object({ console: z.string(), title: z.string() })).mutation(({ input }) => art.resetCover(input.console, input.title)),
      onChanged: t.procedure.subscription(async function* ({ signal }) { for await (const _ of on(art.events, 'changed', { signal })) yield Date.now(); }),
      onStatus: t.procedure.subscription(async function* ({ signal }) { for await (const [s] of on(art.events, 'status', { signal })) yield s as string | null; }),
    }),

    win: t.router({
      state: t.procedure.query(() => deps.win?.()?.state() ?? { fullscreen: false, maximized: false }),
      onState: t.procedure.subscription(async function* ({ signal }) {
        const c = deps.win?.(); if (!c) return;
        for await (const [s] of on(c.events, 'state', { signal })) yield s as WinState;
      }),
      setFullScreen: t.procedure.input(z.object({ on: z.boolean() })).mutation(({ input }) => { deps.win?.()?.setFullScreen(input.on); }),
      toggleFullScreen: t.procedure.mutation(() => { deps.win?.()?.toggle(); }),
      overlay: t.procedure.input(z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i), symbol: z.string().regex(/^#[0-9a-f]{6}$/i) })).mutation(({ input }) => { deps.win?.()?.setOverlay(input.color, input.symbol); }),
    }),

    updates: t.router({
      state: t.procedure.query(() => deps.upd?.()?.state() ?? null),
      onState: t.procedure.subscription(async function* ({ signal }) {
        const u = deps.upd?.(); if (!u) return;
        for await (const [s] of on(u.events, 'state', { signal })) yield s as UpdState;
      }),
      check: t.procedure.mutation(async () => (await deps.upd?.()?.check()) ?? null),
      install: t.procedure.mutation(() => deps.upd?.()?.install() ?? false),
    }),

    system: t.router({
      user: t.procedure.query(() => { try { return userInfo().username; } catch { return ''; } }),
      openLog: t.procedure.mutation(() => { const f = logFile(); if (f) shell.showItemInFolder(f); }),
      setLang: t.procedure.input(z.object({ lang: z.enum(['pt', 'en']) })).mutation(({ input }) => { setLang(input.lang); kvSet(deps.db, 'lang', input.lang); }),
      quit: t.procedure.mutation(() => { const b = deps.bg?.(); if (b) b.quitting = true; setTimeout(() => app.quit(), 120); }),
      clipboard: t.procedure.mutation(() => clipboard.readText()),
    }),

    ingame: t.router({
      current: t.procedure.query(() => player.current()),
      onSummon: t.procedure.subscription(async function* ({ signal }) { if (!deps.ingame) return; for await (const [title] of on(deps.ingame.events, 'summon', { signal })) yield String(title ?? ''); }),
      onShot: t.procedure.subscription(async function* ({ signal }) { if (!deps.ingame) return; for await (const [s] of on(deps.ingame.events, 'shot', { signal })) yield s as { title: string; file: string }; }),
      shots: t.procedure.input(z.object({ title: z.string() })).query(({ input }) => deps.ingame?.list(input.title) ?? []),
      openShots: t.procedure.input(z.object({ title: z.string() })).mutation(async ({ input }) => { const d = deps.ingame?.folder(input.title); if (d && existsSync(d)) await shell.openPath(d); }),
      back: t.procedure.mutation(async () => { if (deps.ingame) await deps.ingame.back(); else deps.win?.()?.minimize(); }),
      binds: t.procedure.query(() => readAllBinds(kvGet(deps.db, 'pad.binds'))),
      setBind: t.procedure.input(z.object({ pad: z.string().max(300), action: z.enum(['summon', 'shot']), bind: z.array(z.string()).nullable() })).mutation(({ input }) => {
        const all = readAllBinds(kvGet(deps.db, 'pad.binds'));
        if (input.bind == null) delete all[input.pad];
        else {
          const b = cleanBind(input.bind);
          if (!b) throw new Error(tt('Nenhum botão reconhecido. Tente de novo.'));
          const cur = bindsFor(all, input.pad);
          if (sameBind(b, input.action === 'summon' ? cur.shot : cur.summon)) throw new Error(tt('Essa combinação já é usada pelo outro atalho.'));
          all[input.pad] = { ...all[input.pad], [input.action]: b };
        }
        kvSet(deps.db, 'pad.binds', JSON.stringify(all));
        return all;
      }),
      removeShot: t.procedure.input(z.object({ url: z.string() })).mutation(({ input }) => deps.ingame?.remove(input.url) ?? false),
    }),

    web: t.router({
      open: t.procedure.input(z.object({ url: z.string(), rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) })).mutation(({ input }) => deps.web?.open(input.url, input.rect) ?? false),
      place: t.procedure.input(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })).mutation(({ input }) => { deps.web?.place(input); }),
      scroll: t.procedure.input(z.object({ dy: z.number() })).mutation(({ input }) => { deps.web?.scroll(input.dy); }),
      back: t.procedure.mutation(() => { deps.web?.back(); }),
      external: t.procedure.mutation(() => { deps.web?.external(); deps.web?.close(); }),
      close: t.procedure.mutation(() => { deps.web?.close(true); }),
      onClosed: t.procedure.subscription(async function* ({ signal }) { if (!deps.web) return; for await (const _ of on(deps.web.events, 'closed', { signal })) yield Date.now(); }),
      onState: t.procedure.subscription(async function* ({ signal }) { if (!deps.web) return; for await (const [s] of on(deps.web.events, 'state', { signal })) yield s as { loading: boolean; title: string; url: string }; }),
    }),

    background: t.router({
      get: t.procedure.query(() => deps.bg?.()?.prefs() ?? { tray: false, track: false, autostart: false, screen: false, trayOk: true }),
      set: t.procedure.input(z.object({ tray: z.boolean().optional(), track: z.boolean().optional(), autostart: z.boolean().optional(), screen: z.boolean().optional() })).mutation(({ input }) => {
        const b = deps.bg?.(); if (!b) throw new Error(tt('Indisponível.'));
        return b.set(input);
      }),
      shortcut: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
        const b = deps.bg?.(); if (!b) throw new Error(tt('Indisponível.'));
        return b.shortcut(input.id);
      }),
    }),

    i18n: t.router({
      translate: t.procedure.input(z.object({ text: z.string().max(8000) })).query(({ input }) => tr.translate(input.text)),
    }),

    fs: t.router({
      onPick: t.procedure.subscription(async function* ({ signal }) { for await (const [r] of on(pickBus, 'pick', { signal })) yield r as PickRequest; }),
      stat: t.procedure.input(z.object({ path: z.string() })).mutation(({ input }) => {
        const raw = input.path.trim().replace(/^["']+|["']+$/g, '').replace(/^~(?=$|[\\/])/, homedir());
        if (!raw) return { path: '', exists: false, dir: false };
        const full = resolve(raw);
        try { return { path: full, exists: true, dir: statSync(full).isDirectory() }; } catch { return { path: full, exists: false, dir: false }; }
      }),
      answer: t.procedure.input(z.object({ id: z.number(), path: z.string().nullable(), native: z.boolean().optional() })).mutation(({ input }) => {
        const f = pending.get(input.id); pending.delete(input.id);
        f?.(input.native ? '\u0000native' : input.path);
      }),
      list: t.procedure.input(z.object({ path: z.string(), kind: z.enum(['dir', 'exe', 'img']) })).query(({ input }) => {
        const p = parse(input.path);
        return { path: input.path, parent: p.root === input.path ? null : dirname(input.path), entries: listDir(input.path, input.kind), places: places() };
      }),
    }),

    settings: t.router({
      steamKey: t.procedure.query(() => kvGet(db, 'steam.apikey') ?? ''),
      setSteamKey: t.procedure.input(z.object({ key: z.string().max(64) })).mutation(async ({ input }) => {
        const k = input.key.trim();
        if (k && !/^[0-9A-F]{32}$/i.test(k)) throw new Error(tt('A chave da Steam tem 32 letras e números (0-9, A-F).'));
        if (k) kvSet(db, 'steam.apikey', k); else db.prepare('DELETE FROM kv WHERE key = ?').run('steam.apikey');
        await ach.resyncKind(['steam', 'steam-emu']);
        return k;
      }),
      gog: t.procedure.query(() => deps.gog?.state() ?? { signedIn: false, name: null }),
      gogLogin: t.procedure.mutation(async () => {
        if (!deps.gog) return { signedIn: false, name: null };
        const ok = await deps.gog.login(deps.mainWindow?.() ?? null);
        if (ok) await ach.resyncKind(['gog']);
        return deps.gog.state();
      }),
      gogLogout: t.procedure.mutation(() => { deps.gog?.logout(); return { signedIn: false, name: null }; }),
      portsDir: t.procedure.query(() => portsDirOf(deps)),
      pickPortsDir: t.procedure.mutation(async () => {
        const dir = await pick(tt('Onde o Cosmo deve instalar os jogos?'), ['openDirectory', 'createDirectory'], { defaultPath: portsDirOf(deps) });
        if (dir) kvSet(db, 'portsDir', dir);
        return portsDirOf(deps);
      }),
    }),

    wine: t.router({
      status: t.procedure.query(() => wineStatus()),
      versions: t.procedure.query(() => listVersions()),
      config: t.procedure.input(z.object({ id: z.string().optional() })).query(({ input }) => ({
        global: mergeConfig(readPatch(db, null)),
        game: input.id ? loadConfig(db, input.id) : null,
        override: input.id ? readPatch(db, input.id) : null,
        hasPrefix: !!input.id && existsSync(prefixDir(input.id)),
        logFile: input.id ? runLog(input.id) : null,
        askDownloads: askBeforeDownload(db),
      })),
      setAskDownloads: t.procedure.input(z.object({ on: z.boolean() })).mutation(({ input }) => setAskBeforeDownload(db, input.on)),
      onAskDownload: t.procedure.subscription(async function* ({ signal }) { for await (const [r] of on(dlBus, 'ask', { signal })) yield r as DownloadRequest; }),
      answerDownload: t.procedure.input(z.object({ id: z.number(), ok: z.boolean() })).mutation(({ input }) => {
        const f = dlPending.get(input.id); dlPending.delete(input.id); f?.(input.ok);
      }),
      setConfig: t.procedure.input(z.object({ id: z.string().optional(), patch: z.record(z.string(), z.unknown()) })).mutation(({ input }) => writePatch(db, input.id ?? null, input.patch)),
      resetGame: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => resetGame(db, input.id)),
      pickPrefix: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const dir = await pick(tt('Escolha a pasta do prefixo do Wine'), ['openDirectory', 'createDirectory'], { defaultPath: readPatch(db, input.id).prefixPath ?? prefixDir(input.id) });
        if (dir) writePatch(db, input.id, { prefixPath: dir });
        return loadConfig(db, input.id);
      }),
      remoteBuilds: t.procedure.query(() => remoteBuilds()),
      installBuild: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => installBuild(input.id)),
      removeBuild: t.procedure.input(z.object({ dir: z.string() })).mutation(({ input }) => removeBuild(input.dir)),
      installUmu: t.procedure.mutation(() => installUmu()),
      installWinetricks: t.procedure.mutation(() => installWinetricks()),
      winetricks: t.procedure.input(z.object({ id: z.string(), verbs: z.array(z.string().regex(VERB)).min(1) })).mutation(({ input }) => runWinetricks(db, input.id, input.verbs)),
      openLog: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => { if (existsSync(runLog(input.id))) shell.showItemInFolder(runLog(input.id)); }),
    }),

    ports: t.router({
      install: t.procedure.input(z.object({ catalogId: z.string() })).mutation(({ input }) => ports.installFromCatalog(input.catalogId)),
      installRepo: t.procedure.input(z.object({ repo: z.string() })).mutation(({ input }) => ports.install(parseRepo(input.repo))),
      checkUpdate: t.procedure.input(z.object({ id: z.string(), force: z.boolean().optional() })).query(({ input }) => ports.checkUpdate(input.id, input.force)),
      update: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ports.update(input.id)),
      uninstall: t.procedure.input(z.object({ id: z.string(), deletePrefix: z.boolean().optional() })).mutation(async ({ input }) => { const r = await ports.uninstall(input.id); if (input.deletePrefix) deletePrefix(input.id); return r; }),
      setSource: t.procedure.input(z.object({ id: z.string(), repo: z.string().nullable() })).mutation(({ input }) => {
        ach.patchGame(input.id, { sourceRepo: input.repo ? parseRepo(input.repo) : null, release: null });
        db.prepare('DELETE FROM kv WHERE key = ?').run(`upd.${input.id}`);
        return ach.getGame(input.id);
      }),
      onProgress: t.procedure.subscription(async function* ({ signal }) {
        for await (const [p] of on(ports.events, 'progress', { signal })) yield p as InstallProgress;
      }),
    }),

    play: t.router({
      start: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => player.play(input.id)),
      quit: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => player.quit(input.id)),
      stats: t.procedure.input(z.object({ id: z.string().optional() }).optional()).query(({ input }) => player.stats(input?.id)),
      onEvent: t.procedure.subscription(async function* ({ signal }) {
        for await (const [e] of on(player.events, 'play', { signal })) yield e as PlayEvent;
      }),
    }),

    library: t.router({
      summary: t.procedure.query((): LibrarySummary => {
        const pc = perConsole(db), rc = radarCounts(db), games = ach.listGames().filter(g => !g.missing);
        for (const x of Object.values(pc)) x.installed = 0;
        for (const g of games) (pc[g.console] ??= { recomps: 0, installed: 0, fresh: 0, platforms: 0 }).installed++;
        return {
          catalogTotal: Object.values(pc).reduce((s, x) => s + x.recomps, 0),
          platforms: platformCount(db),
          perConsole: pc,
          installed: games.length,
          playMs: player.stats().totalMs,
          radar: { unseen: rc.unseen ?? 0, fresh: rc.fresh ?? 0, updates: rc.updates ?? 0 },
          achievements: ach.totals(),
        };
      }),
    }),

    catalog: t.router({
      markRadarSeen: t.procedure.mutation(() => { markRadarSeen(db); }),
      list: t.procedure.input(z.object({ console: z.string().optional(), consoles: z.array(z.string()).optional(), search: z.string().optional() }).optional())
        .query(({ input }) => listCatalog(db, input ?? {})),
      refresh: t.procedure.input(z.object({ force: z.boolean().optional() }).optional())
        .mutation(({ input }) => { loadSources(app.getPath('userData')); return refreshCatalog(db, input ?? {}); }),
      /** Abre o fontes.json (catálogos extras) no editor padrão. */
      openSources: t.procedure.mutation(async () => { loadSources(app.getPath('userData')); await shell.openPath(sourcesFile(app.getPath('userData'))); }),
      sources: t.procedure.query(() => getExtraCatalogs()),
      radar: t.procedure.query(() => listRadar(db)),
      dismiss: t.procedure.input(z.object({ ids: z.array(z.number()) })).mutation(({ input }) => { dismissRadar(db, input.ids); }),
      seen: t.procedure.input(z.object({ ids: z.array(z.number()) })).mutation(({ input }) => { seeRadar(db, input.ids); }),
      info: t.procedure.query(() => ({
        generatedAt: kvGet(db, 'catalog.generatedAt'),
        checkedAt: Number(kvGet(db, 'catalog.checkedAt') ?? 0) || null,
      })),
    }),

    games: t.router({
      list: t.procedure.query(() => ach.listGames()),
      get: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => ach.getGame(input.id)),
      chooseExe: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const g = ach.getGame(input.id);
        const file = await pick(tt('Qual programa abre {0}?', { 0: g.title }), ['openFile'], { defaultPath: g.installDir, filters: process.platform === 'win32' ? [{ name: 'Programas', extensions: ['exe', 'bat', 'lnk'] }] : [] });
        if (file) ach.patchGame(input.id, { exe: file });
        return ach.getGame(input.id);
      }),
      addFromDialog: t.procedure.input(z.object({ catalogId: z.string().optional() }).optional()).mutation(async ({ input }) => {
        const dir = await pick(input?.catalogId ? tt('Escolha a pasta onde você instalou o jogo') : tt('Escolha a pasta do jogo'), ['openDirectory']);
        if (!dir) return null;
        const g = await ach.addGame(dir, { catalogId: input?.catalogId ?? null });
        if (g.catalogId || g.adapter || g.console !== 'other') return g;
        const c = await askPlatform(g.title, null);
        if (c && c !== 'other' && Object.hasOwn(CONSOLE_NAME, c)) ach.patchGame(g.id, { console: c });
        return ach.getGame(g.id);
      }),
      changePlatform: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const g = ach.getGame(input.id);
        const c = await askPlatform(g.title, g.console);
        if (c && c !== g.console && Object.hasOwn(CONSOLE_NAME, c)) ach.patchGame(g.id, { console: c });
        return ach.getGame(g.id);
      }),
      onAskPlatform: t.procedure.subscription(async function* ({ signal }) { for await (const [r] of on(platBus, 'ask', { signal })) yield r as PlatformRequest; }),
      answerPlatform: t.procedure.input(z.object({ id: z.number(), console: z.string().nullable() })).mutation(({ input }) => {
        const f = platPending.get(input.id); platPending.delete(input.id); f?.(input.console);
      }),
      relink: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const dir = await pick(tt('Onde está {0} agora?', { 0: ach.getGame(input.id).title }), ['openDirectory']);
        return dir ? ach.relocate(input.id, dir) : null;
      }),
      /** O que "apagar tudo" levaria junto: pastas de saves e conquistas do crack fora da pasta do jogo. */
      removePlan: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => ({ saves: ach.saveDirs(input.id) })),
      /** keep: só some da biblioteca (volta com o histórico se instalar de novo). Senão apaga o histórico; saves: manda as pastas do crack para a Lixeira. */
      remove: t.procedure.input(z.object({ id: z.string(), deletePrefix: z.boolean().optional(), keep: z.boolean().optional(), saves: z.boolean().optional() })).mutation(async ({ input }) => {
        if (input.keep) return ach.hideGame(input.id);
        if (input.saves) for (const d of ach.saveDirs(input.id)) {
          try { await shell.trashItem(d); }
          catch (e) { throw new Error(tt('Não deu para mandar {0} para a Lixeira: {1}', { 0: d, 1: e instanceof Error ? e.message : String(e) })); }
        }
        ach.removeGame(input.id);
        if (input.deletePrefix) deletePrefix(input.id);
      }),
      uninstallPlan: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => planFor(input.id)),
      uninstall: t.procedure.input(z.object({ id: z.string(), deletePrefix: z.boolean().optional() })).mutation(async ({ input }) => {
        const g = ach.getGame(input.id);
        if (g.running) throw new Error(tt('Feche o jogo antes.'));
        const plan = planFor(input.id);
        if (plan.kind === 'blocked') throw new Error(plan.reason);
        ach.rememberKeys(input.id);
        if (plan.kind === 'managed') await ports.uninstall(input.id);
        else {
          if (plan.kind === 'steam') await shell.openExternal(`steam://uninstall/${plan.appid}`);
          else {
            try { await shell.trashItem(plan.path); }
            catch (e) { throw new Error(/EBUSY|EPERM|in use|em uso/i.test(String(e)) ? tt('Um arquivo está em uso. Feche o jogo e tente de novo.') : tt('Não deu para mandar para a Lixeira: {0}', { 0: e instanceof Error ? e.message : String(e) })); }
          }
          ach.markUninstalled(input.id);
          db.prepare('DELETE FROM kv WHERE key = ?').run(`upd.${input.id}`);
        }
        if (input.deletePrefix) deletePrefix(input.id);
        return plan.kind;
      }),
      openFolder: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const g = ach.listGames().find(x => x.id === input.id);
        if (g) await shell.openPath(g.installDir);
      }),
    }),

    achievements: t.router({
      dismiss: t.procedure.input(z.object({ items: z.array(z.object({ gameId: z.string(), achId: z.number() })).optional() })).mutation(({ input }) => ach.dismissRecent(input.items)),
      recent: t.procedure.input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
        .query(({ input }) => ach.recentUnlocks(input?.limit)),
      supported: t.procedure.query(() => ADAPTERS.map(a => ({ id: a.id, label: a.label, repos: a.repos }))),
      forGame: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => ach.forGame(input.id)),
      resync: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ach.resync(input.id)),
      onUnlock: t.procedure.subscription(async function* ({ signal }) {
        for await (const [e] of on(ach.events, 'unlock', { signal })) yield e as UnlockEvent;
      }),
      onComplete: t.procedure.subscription(async function* ({ signal }) {
        for await (const [e] of on(ach.events, 'complete', { signal })) yield e as CompleteEvent;
      }),
      onChanged: t.procedure.subscription(async function* ({ signal }) {
        for await (const [id] of on(ach.events, 'changed', { signal })) yield id as string;
      }),
    }),
  });
}

export type AppRouter = ReturnType<typeof createRouter>;
