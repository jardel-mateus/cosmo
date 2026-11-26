import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import { tt } from '@shared/i18n';

export type UpdStatus = 'dev' | 'off' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';

/** O electron-builder só grava o app-update.yml quando o package.json tem "publish". Sem ele, não há onde procurar versões. */
const hasFeed = () => { try { return existsSync(join(process.resourcesPath, 'app-update.yml')); } catch { return false; } };
export interface UpdState { status: UpdStatus; current: string; version: string | null; pct: number; error: string | null; checkedAt: number | null }

const SIX_HOURS = 6 * 3600_000, SOON = 10 * 60_000;

export function friendlyUpdError(m: string) {
  if (/latest\.yml|\b404\b/i.test(m)) return { text: tt('A versão nova ainda está sendo publicada no GitHub. O Cosmo tenta de novo em alguns minutos.'), soon: true };
  if (/ENOTFOUND|ECONNRE|ETIMEDOUT|EAI_AGAIN|net::ERR|socket hang up/i.test(m)) return { text: tt('Sem conexão com o GitHub agora. O Cosmo tenta de novo mais tarde.'), soon: true };
  return { text: tt('Não deu para verificar: {0}', { 0: (m.split('\n')[0] ?? m).slice(0, 160) }), soon: false };
}

export class Updater {
  readonly events = new EventEmitter();
  private s: UpdState = { status: !app.isPackaged ? 'dev' : hasFeed() ? 'idle' : 'off', current: app.getVersion(), version: null, pct: 0, error: null, checkedAt: null };

  constructor(private beforeInstall: () => void) {
    if (this.s.status !== 'idle') return;
    const u = electronUpdater.autoUpdater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    u.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }));
    u.on('update-available', i => this.set({ status: 'downloading', version: i.version, pct: 0, checkedAt: Date.now() }));
    u.on('download-progress', p => this.set({ status: 'downloading', pct: Math.round(p.percent) }));
    u.on('update-downloaded', i => this.set({ status: 'ready', version: i.version, pct: 100 }));
    u.on('error', e => this.fail(e));
    setTimeout(() => void this.check(), 15_000);
    setInterval(() => void this.check(), SIX_HOURS);
  }

  state() { return this.s; }

  private retry: NodeJS.Timeout | undefined;
  private fail(e: unknown) {
    const f = friendlyUpdError(e instanceof Error ? e.message : String(e));
    this.set({ status: 'error', error: f.text, checkedAt: Date.now() });
    if (f.soon) { clearTimeout(this.retry); this.retry = setTimeout(() => void this.check(), SOON); }
  }

  private set(p: Partial<UpdState>) { this.s = { ...this.s, ...p }; this.events.emit('state', this.s); }

  async check() {
    if (!app.isPackaged || this.s.status === 'off' || this.s.status === 'downloading' || this.s.status === 'ready') return this.s;
    try { await electronUpdater.autoUpdater.checkForUpdates(); } catch (e) { this.fail(e); }
    return this.s;
  }

  install() {
    if (this.s.status !== 'ready') return false;
    this.beforeInstall();
    setImmediate(() => electronUpdater.autoUpdater.quitAndInstall(true, true));
    return true;
  }
}
