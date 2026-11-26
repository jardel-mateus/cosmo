import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';

export interface WinState { fullscreen: boolean; maximized: boolean }
interface Saved { x?: number; y?: number; width: number; height: number; maximized: boolean; fullscreen: boolean }

export const TITLE_H = 36;

export class WinCtl {
  readonly events = new EventEmitter();
  win: BrowserWindow | null = null;
  private file: string;
  private saved: Saved;
  private timer: NodeJS.Timeout | null = null;
  private overlay = { color: '#07020f', symbolColor: '#ff4fa8' };

  constructor(userData: string) {
    this.file = join(userData, 'janela.json');
    this.saved = this.load();
  }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Saved;
      if (s.width > 0 && s.height > 0) return s;
    } catch { }
    const a = screen.getPrimaryDisplay().workAreaSize;
    return { width: Math.round(a.width * 0.9), height: Math.round(a.height * 0.9), maximized: true, fullscreen: false };
  }

  private visible(s: Saved) {
    if (s.x == null || s.y == null) return false;
    return screen.getAllDisplays().some(d => { const b = d.workArea; return s.x! < b.x + b.width - 100 && s.x! + s.width > b.x + 100 && s.y! >= b.y - 20 && s.y! < b.y + b.height - 100; });
  }

  options(): Electron.BrowserWindowConstructorOptions {
    const s = this.saved;
    return {
      width: s.width, height: s.height, ...(this.visible(s) ? { x: s.x, y: s.y } : { center: true }),
      titleBarStyle: 'hidden', titleBarOverlay: { ...this.overlay, height: TITLE_H },
    };
  }

  attach(win: BrowserWindow, show = true) {
    this.win = win;
    const changed = () => { this.events.emit('state', this.state()); this.persist(); };
    win.once('ready-to-show', () => {
      if (!show) return;
      if (this.saved.maximized) win.maximize();
      win.show();
      if (this.saved.fullscreen) win.setFullScreen(true);
    });
    for (const ev of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize'] as const) win.on(ev as 'maximize', changed);
    win.on('resize', () => this.persist());
    win.on('move', () => this.persist());
    win.on('close', () => this.write());
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) { e.preventDefault(); this.toggle(); }
    });
  }

  state(): WinState { const w = this.win; return { fullscreen: !!w?.isFullScreen(), maximized: !!w?.isMaximized() }; }
  toggle() { const w = this.win; if (w) w.setFullScreen(!w.isFullScreen()); }
  setFullScreen(on: boolean) { this.win?.setFullScreen(on); }
  setOverlay(color: string, symbolColor: string) {
    this.overlay = { color, symbolColor };
    const w = this.win;
    if (w && !w.isDestroyed() && process.platform !== 'darwin') w.setTitleBarOverlay({ ...this.overlay, height: TITLE_H });
  }
  minimize() { this.win?.minimize(); }

  summon() {
    const w = this.win; if (!w || w.isDestroyed()) return;
    this.reveal();
    w.setAlwaysOnTop(true, 'screen-saver');
    w.moveTop();
    w.focus();
    setTimeout(() => { if (!w.isDestroyed()) w.setAlwaysOnTop(false); }, 400);
  }

  reveal() {
    const w = this.win; if (!w || w.isDestroyed()) return;
    if (!w.isVisible()) { if (this.saved.maximized) w.maximize(); w.show(); if (this.saved.fullscreen) w.setFullScreen(true); }
    if (w.isMinimized()) w.restore();
    w.focus();
  }

  private persist() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), 500);
  }

  private write() {
    const w = this.win; if (!w || w.isDestroyed()) return;
    const fullscreen = w.isFullScreen(), maximized = w.isMaximized();
    const b = fullscreen || maximized ? null : w.getBounds();
    this.saved = { ...this.saved, ...(b ? { x: b.x, y: b.y, width: b.width, height: b.height } : {}), fullscreen, maximized };
    try { writeFileSync(this.file, JSON.stringify(this.saved)); } catch { }
  }
}
