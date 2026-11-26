import { BrowserWindow, session } from 'electron';
import type { DB } from './db';
import { kvGet, kvSet } from './db';
import { log } from './log';
import type { Fetch } from './achievements/net';
import { tt } from '@shared/i18n';

// Credenciais públicas do cliente do GOG Galaxy, as mesmas que Heroic, Playnite e lgogdownloader usam.
const CLIENT_ID = '46899977096215655';
const CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';
const KEY = 'gog.auth';

interface Auth { access: string; refresh: string; userId: string; expiresAt: number; name?: string | null }

export class GogAccount {
  constructor(private db: DB, private fetch: Fetch) {}

  private read(): Auth | null { try { return JSON.parse(kvGet(this.db, KEY) ?? 'null') as Auth | null; } catch { return null; } }
  private save(a: Auth | null) { if (a) kvSet(this.db, KEY, JSON.stringify(a)); else this.db.prepare('DELETE FROM kv WHERE key = ?').run(KEY); }

  state() { const a = this.read(); return a ? { signedIn: true, name: a.name ?? null } : { signedIn: false, name: null }; }
  logout() { this.save(null); void session.fromPartition('persist:gog').clearStorageData().catch(() => {}); }

  private async exchange(params: Record<string, string>) {
    const q = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params });
    const r = await this.fetch(`https://auth.gog.com/token?${q}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(tt('a GOG recusou o login (HTTP {0})', { 0: r.status }));
    const j = await r.json() as { access_token: string; refresh_token: string; user_id: string; expires_in: number };
    const prev = this.read();
    const a: Auth = { access: j.access_token, refresh: j.refresh_token, userId: String(j.user_id), expiresAt: Date.now() + (j.expires_in - 120) * 1000, name: prev?.name ?? null };
    if (!a.name) {
      try { const u = await this.fetch(`https://embed.gog.com/userData.json`, { headers: { Authorization: `Bearer ${a.access}` } }); if (u.ok) a.name = ((await u.json()) as { username?: string }).username ?? null; } catch { }
    }
    this.save(a);
    return a;
  }

  /** Abre a página de login da GOG numa janela do Cosmo e guarda o token. */
  login(parent: BrowserWindow | null): Promise<boolean> {
    return new Promise(resolve => {
      const w = new BrowserWindow({ width: 520, height: 720, parent: parent ?? undefined, modal: !!parent, autoHideMenuBar: true, title: tt('Entrar na GOG'),
        webPreferences: { partition: 'persist:gog', sandbox: true, contextIsolation: true, nodeIntegration: false } });
      let done = false;
      const finish = (ok: boolean) => { if (done) return; done = true; if (!w.isDestroyed()) w.close(); resolve(ok); };
      const check = (url: string) => {
        if (!url.startsWith('https://embed.gog.com/on_login_success')) return false;
        const code = new URL(url).searchParams.get('code');
        if (!code) { finish(false); return true; }
        this.exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }).then(() => finish(true), e => { log('login da GOG falhou', String(e)); finish(false); });
        return true;
      };
      w.webContents.on('will-redirect', (e, url) => { if (check(url)) e.preventDefault(); });
      w.webContents.on('will-navigate', (e, url) => { if (check(url)) e.preventDefault(); });
      w.webContents.on('did-navigate', (_e, url) => { check(url); });
      w.on('closed', () => finish(false));
      const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', layout: 'client2' });
      void w.loadURL(`https://auth.gog.com/auth?${q}`);
    });
  }

  /** Token válido (renova sozinho se venceu). */
  async token(): Promise<{ token: string; userId: string } | null> {
    let a = this.read();
    if (!a) return null;
    if (Date.now() >= a.expiresAt) {
      try { a = await this.exchange({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
      catch (e) { log('não deu para renovar o login da GOG', String(e)); return null; }
    }
    return { token: a.access, userId: a.userId };
  }
}
