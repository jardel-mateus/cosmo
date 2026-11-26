import { EventEmitter } from 'node:events';
import { type BrowserWindow, shell, WebContentsView } from 'electron';

export interface Rect { x: number; y: number; width: number; height: number }

export const allowedWeb = (url: string) => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };

export class WebPane {
  readonly events = new EventEmitter<{ closed: []; state: [{ loading: boolean; title: string; url: string }] }>();
  private view: WebContentsView | null = null;

  constructor(private win: () => BrowserWindow | null) {}

  open(url: string, rect: Rect) {
    const w = this.win();
    if (!w || !allowedWeb(url)) return false;
    this.close(true);
    const v = new WebContentsView({ webPreferences: { partition: 'persist:web', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    v.setBackgroundColor('#101218');
    const wc = v.webContents;
    wc.setWindowOpenHandler(({ url: u }) => { if (allowedWeb(u)) void wc.loadURL(u); return { action: 'deny' }; });
    wc.on('will-navigate', (e, u) => { if (!allowedWeb(u)) e.preventDefault(); });
    wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); this.close(); } });
    const state = () => this.events.emit('state', { loading: wc.isLoading(), title: wc.getTitle(), url: wc.getURL() });
    wc.on('did-start-loading', state);
    wc.on('did-stop-loading', state);
    wc.on('page-title-updated', state);
    w.contentView.addChildView(v);
    this.view = v;
    this.place(rect);
    void wc.loadURL(url);
    return true;
  }

  place(rect: Rect) {
    if (!this.view) return;
    const r = (n: number) => Math.max(0, Math.round(n));
    this.view.setBounds({ x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) });
  }

  scroll(dy: number) {
    const wc = this.view?.webContents;
    if (!wc) return;
    void wc.executeJavaScript(`window.scrollBy({ top: ${Number(dy) || 0}, behavior: 'smooth' })`, false).catch(() => {});
  }

  back() { const n = this.view?.webContents.navigationHistory; if (n?.canGoBack()) n.goBack(); }

  external() { const u = this.view?.webContents.getURL(); if (u && allowedWeb(u)) void shell.openExternal(u); }

  close(silent = false) {
    const v = this.view;
    if (!v) return;
    this.view = null;
    const w = this.win();
    const hadFocus = v.webContents.isFocused();
    w?.contentView.removeChildView(v);
    v.webContents.close();
    // A página tinha o foco do teclado; sem devolver, o Cosmo fica sem ouvir teclado e controle depois de fechar.
    if (w && !w.isDestroyed() && (hadFocus || w.isFocused())) w.webContents.focus();
    if (!silent) this.events.emit('closed');
  }
}
