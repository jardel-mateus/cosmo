import { existsSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, globalShortcut, net, protocol, shell } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import { kvGet, openDb } from './db';
import { wineEvents } from './wine/components';
import { createRouter } from './router';
import { AchievementService } from './achievements/service';
import { refreshCatalog } from './catalog';
import { loadSources } from './sources';
import { createGitHub, githubToken, type Fetch } from './ports/github';
import { Ports } from './ports/installer';
import { Player } from './play';
import { portsDirOf } from './router';
import { Artwork } from './artwork/service';
import { GameInfoService } from './artwork/info';
import { createEmulatorResolver } from './emulators';
import { WebPane } from './web';
import { InGame } from './ingame';
import { type Desk, Win32 } from './win32';
import { LinuxDesk } from './linux';
import { bindsFor, readAllBinds } from '@shared/binds';
import { Translator } from './translate';
import { WinCtl } from './window';
import { Background, playArg, startHidden } from './background';
import { Updater } from './updater';
import { initLog, log } from './log';
import { getLang, pickLang, setLang, tt } from '@shared/i18n';
import { fmtPct, isRare } from '@shared/rarity';
import { setAchNet } from './achievements/net';
import { GogAccount } from './gog';

if (process.env.CARTUCHO_USER_DATA) app.setPath('userData', process.env.CARTUCHO_USER_DATA);
const lockData = { version: app.getVersion() };
let locked = app.requestSingleInstanceLock(lockData);
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const APP_ORIGIN = 'app://cosmo';
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const isOurPage = (url: string) => (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${APP_ORIGIN}/`));

let win: BrowserWindow | null = null;
let ctl: WinCtl | null = null;
let bg: Background | null = null;
let upd: Updater | null = null;

function appIcon() {
  const ext = process.platform === 'win32' ? 'ico' : 'png';
  return [join(app.getAppPath(), 'build', `icon.${ext}`), join(process.resourcesPath, `icon.${ext}`), join(__dirname, '../renderer/icon.png')].find(p => existsSync(p));
}

function createWindow(show = true) {
  ctl ??= new WinCtl(app.getPath('userData'));
  win = new BrowserWindow({
    ...ctl.options(), minWidth: 1024, minHeight: 640,
    backgroundColor: '#05070f', show: false, autoHideMenuBar: true, title: tt('Cosmo'),
    icon: appIcon(),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  ctl.attach(win, show);
  const w = win;
  w.on('unresponsive', () => log('janela sem resposta'));
  w.on('responsive', () => log('janela voltou a responder'));
  w.webContents.on('render-process-gone', (_e, d) => { log('a tela caiu:', d.reason, d.exitCode); if (d.reason !== 'clean-exit' && !w.isDestroyed()) w.reload(); });
  win.on('close', e => { if (bg?.shouldHideOnClose()) { e.preventDefault(); win?.hide(); bg.hidden(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOurPage(url)) e.preventDefault(); });

  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

app.on('second-instance', (_e, argv, _dir, data) => {
  const v = (data as { version?: string } | null)?.version;
  if (v && newer(v, app.getVersion())) {
    log(`Cosmo ${v} abrindo: esta versão (${app.getVersion()}) fecha para dar lugar a ela`);
    if (bg) bg.quitting = true;
    app.quit();
    return;
  }
  const key = JSON.stringify(argv.slice(1)), now = Date.now();
  if (key === lastArgs.key && now - lastArgs.at < 12_000) return;
  lastArgs = { key, at: now };
  void bg?.handleArgs(argv).then(played => { if (!played) bg?.show(); });
});
let lastArgs = { key: '', at: 0 };

function newer(a: string, b: string) {
  const p = (x: string) => x.split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

async function takeLock() {
  for (let i = 0; !locked && i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    locked = app.requestSingleInstanceLock(lockData);
  }
  return locked;
}

if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'app.cosmo' : process.execPath);

app.on('child-process-gone', (_e, d) => log('processo do Electron caiu:', d.type, d.reason, d.exitCode, d.name ?? ''));

void app.whenReady().then(async () => {
  if (!locked && !(await takeLock())) { app.quit(); return; }
  initLog(app.getPath('userData'));
  log(`Cosmo ${app.getVersion()} abriu`, process.platform, process.arch);
  const root = join(__dirname, '../renderer');
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root + sep)) return new Response('não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const db = openDb(join(app.getPath('userData'), 'cartucho.db'));
  const savedLang = kvGet(db, 'lang');
  setLang(savedLang === 'pt' || savedLang === 'en' ? savedLang : pickLang('auto', app.getLocale()));
  const ach = new AchievementService(db, app.getPath('appData'));
  const player = new Player(db, ach, p => shell.openPath(p), () => { if (win && !win.isDestroyed() && win.isVisible()) { if (win.isMinimized()) win.restore(); win.focus(); } else bg?.gameClosed(); });
  ach.isRunning = player.isRunning;
  const gogAcc = new GogAccount(db, ((url, init) => net.fetch(url, init as RequestInit)) as ConstructorParameters<typeof GogAccount>[1]);
  setAchNet({
    fetch: ((url, init) => net.fetch(url, init as RequestInit)) as NonNullable<Parameters<typeof setAchNet>[0]['fetch']>,
    steamKey: () => kvGet(db, 'steam.apikey') || null,
    gogToken: () => gogAcc.token(),
    lang: () => (getLang() === 'en' ? 'en' : 'pt'),
  });
  player.events.on('play', e => { if (!e.running) setTimeout(() => void ach.refreshRemote(e.gameId), 4000); });
  // 100% durante o jogo: o aviso aparece por cima dele (a comemoração completa espera o Cosmo voltar).
  // Conquista rara (menos de 5% dos jogadores) com o jogo aberto: aviso próprio por cima do jogo.
  ach.events.on('unlock', e => { if (isRare(e.rarity) && player.isRunning(e.gameId)) ingame.rare(e.name, tt('CONQUISTA RARA · {0}% DOS JOGADORES', { 0: fmtPct(e.rarity) }), e.icon ?? null); });
  ach.events.on('complete', e => { if (player.isRunning(e.gameId)) ingame.celebrate(e.gameTitle, tt('100% · TODAS AS {0} CONQUISTAS', { 0: e.total })); });
  player.events.on('play', e => log(`jogo ${e.running ? 'aberto' : 'fechado'}:`, e.title, e.sessionMs ? `${Math.round(e.sessionMs / 60000)} min` : ''));
  const gh = createGitHub({ fetch: ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, ...(process.env.CARTUCHO_GITHUB_API ? { api: process.env.CARTUCHO_GITHUB_API } : {}) });
  const defaultPortsDir = join(app.getPath('home'), 'Games', 'Cosmo');
  const art = new Artwork(join(app.getPath('userData'), 'media'), ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, {
    ...(process.env.CARTUCHO_LAUNCHBOX_METADATA ? { metadataUrl: process.env.CARTUCHO_LAUNCHBOX_METADATA } : {}),
    ...(process.env.CARTUCHO_LAUNCHBOX_IMAGES ? { imageUrl: process.env.CARTUCHO_LAUNCHBOX_IMAGES } : {}),
    extraSources: true, githubToken,
  });
  player.setEmulatorResolver(createEmulatorResolver(ach, art));
  const info = new GameInfoService(db, ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, art);
  void info.startNotas();
  setTimeout(() => info.warm(ach.listGames().filter(g => !g.missing).map(g => ({ console: g.console, platformName: g.platformName, title: g.title, installDir: g.installDir, exe: g.exe, catalogId: g.catalogId }))), 20_000);
  const w32: Desk = process.platform === 'linux' ? new LinuxDesk() : new Win32(app.getPath('userData'));
  const ingame = new InGame({
    root: join(app.getPath('pictures'), 'Cosmo'), w32,
    current: () => player.current(),
    reveal: () => ctl?.summon(),
    refocus: () => { if (win && !win.isDestroyed()) { win.focus(); win.webContents.focus(); } },
    minimize: () => ctl?.minimize(),
    own: () => hwndOf(win),
    visible: () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    focused: () => !!win && !win.isDestroyed() && win.isVisible() && win.isFocused(),
    sameScreen: () => bg?.prefs().screen ?? true,
    binds: id => bindsFor(readAllBinds(kvGet(db, 'pad.binds')), id),
    dirsOf: id => { try { const g = ach.getGame(id); return [g.installDir, g.exe ? dirname(g.exe) : ''].filter(Boolean); } catch { return []; } },
  });
  if (process.platform === 'win32' || process.platform === 'linux') ingame.setActive(true);
  player.events.on('launch', e => void ingame.place(e.dirs, e.pid));
  // Teclado durante o jogo: Home chama o Cosmo e Print Screen tira a captura. Fixas, e só valem
  // com um jogo aberto e o Cosmo fora de foco (fora disso as teclas voltam a ser do sistema).
  let gameKeys = false;
  const syncGameKeys = () => {
    const on = !!player.current() && !(win && !win.isDestroyed() && win.isFocused());
    if (on === gameKeys) return;
    gameKeys = on;
    if (!on) { globalShortcut.unregister('Home'); globalShortcut.unregister('PrintScreen'); return; }
    if (!globalShortcut.register('Home', () => ingame.fromKeyboard('summon'))) log('não deu para usar a tecla Home durante o jogo: outro programa já usa');
    if (!globalShortcut.register('PrintScreen', () => ingame.fromKeyboard('shot'))) log('não deu para usar a tecla Print Screen durante o jogo: outro programa já usa');
  };
  player.events.on('play', () => setTimeout(syncGameKeys, 0));
  app.on('browser-window-focus', syncGameKeys);
  app.on('browser-window-blur', () => setTimeout(syncGameKeys, 0));
  setInterval(syncGameKeys, 3000);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  protocol.handle('media', req => {
    const u = new URL(req.url);
    const file = u.hostname === 'art' ? art.resolve(decodeURIComponent(u.pathname)) : u.hostname === 'shots' ? ingame.resolve(u.pathname) : null;
    if (!file) return new Response('não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then(r => {
      const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
      return new Response(r.body, { status: r.status, headers: h });
    });
  });
  const ports = new Ports(db, ach, gh, () => portsDirOf({ db, defaultPortsDir }), player.isRunning);
  player.events.on('progress', p => ports.events.emit('progress', p));
  wineEvents.on('progress', p => ports.events.emit('progress', p));
  createIPCHandler({
    router: createRouter({ db, ach, ports, player, art, info, ingame, gog: gogAcc, mainWindow: () => win, web: new WebPane(() => win), win: () => ctl, bg: () => bg, upd: () => upd, tr: new Translator(db, ((url, init) => net.fetch(url, init as RequestInit)) as ConstructorParameters<typeof Translator>[1]), defaultPortsDir }),
    preload: false,
    allow: e => isOurPage(e.senderFrame?.url ?? ''),
  });
  bg = new Background(db, () => ctl, player, ach, appIcon() ?? '');
  upd = new Updater(() => { if (bg) bg.quitting = true; });
  bg.hiddenStart = startHidden(process.argv) || !!playArg(process.argv);
  bg.apply();
  createWindow(!bg.hiddenStart);
  void bg.handleArgs(process.argv);
  void ach.start();
  loadSources(app.getPath('userData'));
  refreshCatalog(db).catch(e => console.warn('[catálogo]', e instanceof Error ? e.message : e));

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else bg?.show(); });
  app.on('before-quit', () => { player.stop(); ach.stop(); w32.stop(); db.close(); });
});

function hwndOf(w: BrowserWindow | null) {
  if (!w || w.isDestroyed()) return null;
  const b = w.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
