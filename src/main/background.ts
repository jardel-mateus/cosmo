import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { kvGet, kvSet, type DB } from './db';
import type { Player } from './play';
import type { AchievementService } from './achievements/service';
import type { WinCtl } from './window';
import { tt } from '@shared/i18n';

export interface BgPrefs { tray: boolean; track: boolean; autostart: boolean; screen: boolean; trayOk: boolean }

const launcher = () => process.env.APPIMAGE || process.execPath;
const quote = (s: string) => `"${s.replace(/(["\\`$])/g, '\\$1')}"`;
const devArgs = () => (app?.isPackaged === false ? `${quote(app.getAppPath())} ` : '');
export function desktopEntry(o: { name: string; comment: string; args: string; icon: string; hidden?: boolean }) {
  return ['[Desktop Entry]', 'Type=Application', `Name=${o.name}`, `Comment=${o.comment}`, `Exec=${quote(launcher())} ${devArgs()}${o.args}`.trim(), `Icon=${o.icon}`, 'Terminal=false', 'Categories=Game;', ...(o.hidden ? ['X-GNOME-Autostart-enabled=true'] : []), ''].join('\n');
}
export function trayMissing(desktop = process.env.XDG_CURRENT_DESKTOP ?? '', enabled: () => string | null = gnomeExtensions) {
  if (process.platform !== 'linux' || !/gnome/i.test(desktop)) return false;
  const list = enabled();
  return list == null ? false : !/appindicator/i.test(list);
}
function gnomeExtensions() {
  try { return execFileSync('gnome-extensions', ['list', '--enabled'], { encoding: 'utf8', timeout: 3000 }); } catch { return null; }
}
const autostartFile = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'cartucho.desktop');

export const startHidden = (argv: string[]) => argv.includes('--hidden');
export const playArg = (argv: string[]) => { const i = argv.indexOf('--play'); return i >= 0 ? argv[i + 1] ?? null : null; };

export class Background {
  private tray: Tray | null = null;
  private noTray = trayMissing();
  quitting = false;
  hiddenStart = false;

  constructor(private db: DB, private ctl: () => WinCtl | null, private player: Player, private games: AchievementService, private icon: string) {
    app.on('before-quit', () => { this.quitting = true; });
  }

  prefs(): BgPrefs {
    const b = (k: string, d: boolean) => { const v = kvGet(this.db, k); return v == null ? d : v === '1'; };
    return { trayOk: !this.noTray, tray: b('bg.tray', !this.noTray), track: b('bg.track', true), screen: b('bg.screen', true), autostart: process.platform === 'win32' ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : process.platform === 'linux' && existsSync(autostartFile()) };
  }

  set(p: Partial<BgPrefs>) {
    if (p.tray != null) kvSet(this.db, 'bg.tray', p.tray ? '1' : '0');
    if (p.track != null) kvSet(this.db, 'bg.track', p.track ? '1' : '0');
    if (p.screen != null) kvSet(this.db, 'bg.screen', p.screen ? '1' : '0');
    if (p.autostart != null && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: p.autostart, args: ['--hidden'] });
    if (p.autostart != null && process.platform === 'linux') {
      const f = autostartFile();
      try {
        if (p.autostart) { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, desktopEntry({ name: 'Cosmo', comment: tt('Abrir o Cosmo'), args: '--hidden', icon: this.icon, hidden: true })); }
        else if (existsSync(f)) unlinkSync(f);
      } catch { }
    }
    this.apply();
    return this.prefs();
  }

  apply() {
    const p = this.prefs();
    this.player.watchExternal(p.track);
    const want = p.tray || this.hiddenStart || p.autostart;
    if (want && !this.tray) this.makeTray();
    else if (!want && this.tray) { this.tray.destroy(); this.tray = null; }
  }

  shouldHideOnClose() { return !this.quitting && this.prefs().tray; }

  hidden() {
    if (!this.tray || kvGet(this.db, 'bg.hint') === '1' || process.platform !== 'win32') return;
    kvSet(this.db, 'bg.hint', '1');
    this.tray.displayBalloon({ iconType: 'info', title: tt('O Cosmo continua aqui'), content: tt('Ele fica na bandeja para contar o tempo de jogo. Para fechar de vez, clique com o botão direito no ícone e escolha Sair.') });
  }

  gameClosed() {
    const w = this.ctl()?.win;
    if (w && !w.isDestroyed() && !w.isVisible() && !this.prefs().tray && !this.prefs().autostart) app.quit();
  }

  show() { this.ctl()?.reveal(); }

  async handleArgs(argv: string[]) {
    const id = playArg(argv);
    if (!id) return false;
    try { await this.player.play(id); } catch (e) { console.warn('[atalho]', e instanceof Error ? e.message : e); this.show(); }
    return true;
  }

  shortcut(id: string) {
    const g = this.games.getGame(id);
    const name = g.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Jogo';
    if (process.platform === 'linux') {
      const entry = desktopEntry({ name: g.title, comment: tt('{0} pelo Cosmo', { 0: g.title }), args: `--play ${id}`, icon: this.icon });
      const apps = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
      const file = join(apps, `cartucho-${id}.desktop`);
      try {
        mkdirSync(apps, { recursive: true }); writeFileSync(file, entry); chmodSync(file, 0o755);
        const desk = app.getPath('desktop');
        if (existsSync(desk)) { const f = join(desk, `${name}.desktop`); writeFileSync(f, entry); chmodSync(f, 0o755); }
      } catch { throw new Error(tt('Não consegui criar o atalho na Área de Trabalho.')); }
      return file;
    }
    if (process.platform !== 'win32') throw new Error(tt('Atalhos só no Windows por enquanto.'));
    const file = join(app.getPath('desktop'), `${name}.lnk`);
    const args = `${app.isPackaged ? '' : `"${app.getAppPath()}" `}--play ${id}`;
    const ok = shell.writeShortcutLink(file, { target: process.execPath, args, description: `${g.title} pelo Cosmo`, ...(g.exe ? { icon: g.exe, iconIndex: 0 } : {}) });
    if (!ok) throw new Error(tt('Não consegui criar o atalho na Área de Trabalho.'));
    return file;
  }

  private makeTray() {
    const img = nativeImage.createFromPath(this.icon).resize({ width: 16, height: 16 });
    this.tray = new Tray(img);
    this.tray.setToolTip('Cosmo');
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: tt('Abrir o Cosmo'), click: () => this.show() },
      { type: 'separator' },
      { label: tt('Sair'), click: () => { this.quitting = true; app.quit(); } },
    ]));
    this.tray.on('click', () => this.show());
  }
}
