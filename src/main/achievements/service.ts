import { EventEmitter } from 'node:events';
import { existsSync, unwatchFile, watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSelfInstall } from '@shared/consoles';
import type { CompleteEvent, ConsoleId, GameAchievements, InstalledGame, InstalledRelease, RecentUnlock, UnlockEvent } from '@shared/types';
import { findGameExe, guessProgram } from '../ports/files';
import { type DB, kvGet, kvSet, tx } from '../db';
import { absUrl } from '../catalog';
import { type Adapter, type AdapterContext, adapterById, adapterForDir } from './adapters';
import type { Unlock } from './saves';
import { humanize } from './discover';
import { atualizarIndice, entradaDo, indiceAdapter, usarIndice, validar } from './indice';
import { crackSaveDirs, scanCrack } from './steam';
import { gogProductId } from './gog';
import { tt } from '@shared/i18n';
import { steamManifest, windowsAppData } from '../steam';
import { readPatch } from '../wine/config';

const ADAPTER_CONSOLE: Record<string, ConsoleId> = { 'unleashed-recomp': 'x360', 'marathon-recomp': 'x360', sonic3air: 'other', rsdkv4: 'other' };

type GameRow = {
  id: string; catalog_id: string | null; title: string; console: string; install_dir: string; adapter: string | null; added_at: number; cover_url: string | null; platform_name: string | null;
  exe: string | null; version: string | null; source_repo: string | null; managed: number; play_ms: number; last_played: number | null; catalog_repo?: string | null;
  uninstalled_at?: number | null; match_keys?: string | null; hidden_at?: number | null;
};
export interface AddExtra { catalogId?: string | null; title?: string; console?: string; exe?: string | null; sourceRepo?: string | null; release?: InstalledRelease | null; managed?: boolean; manifest?: Record<string, number> | null }
const GAME_SQL = `SELECT g.*, c.cover_url, c.platform_name, c.repo catalog_repo,
  (SELECT COALESCE(SUM(p.ended_at - p.started_at), 0) FROM play_session p WHERE p.game_id = g.id AND p.ended_at IS NOT NULL) play_ms,
  (SELECT MAX(p.started_at) FROM play_session p WHERE p.game_id = g.id) last_played
  FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id`;
const imgType = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/png');
export const FEED_DAYS = 14;
/** Conquistas que só se conhece pelo desbloqueio (sem a lista do jogo) ficam com sort a partir daqui. */
const AUTO_SORT = 100_000;
/** Nomes de .exe comuns demais para reconhecer um jogo sozinhos. */
const GENERIC_EXE = /^(game|launcher|start|play|setup|unins\d*|unitycrashhandler(32|64)?|crashreportclient|ue4prereqsetup.*|dxsetup|vc_?redist.*|notification_helper)\.exe$/i;
/** Jeitos de reconhecer o mesmo jogo numa pasta nova: appid da Steam (legítimo ou de crack), id da GOG, nome do .exe. */
export function matchKeys(dir: string, exe: string | null): string[] {
  const out: string[] = [];
  try { const a = steamManifest(dir, exe)?.appid ?? scanCrack(dir)?.appid; if (a) out.push(`steam:${a}`); } catch { }
  try { const g = gogProductId(dir); if (g) out.push(`gog:${g}`); } catch { }
  const name = exe?.split(/[\\/]/).pop()?.toLowerCase();
  if (name && /\.exe$/.test(name) && !GENERIC_EXE.test(name)) out.push(`exe:${name}`);
  return out;
}
const keysOf = (r: { match_keys?: string | null }) => { try { return JSON.parse(r.match_keys ?? '[]') as string[]; } catch { return []; } };
/** Sem os arquivos do jogo: a pasta sumiu, ou foi desinstalado e o programa não está mais lá (o Cosmo deixa saves na pasta). */
const isGone = (r: { install_dir: string; exe: string | null; uninstalled_at?: number | null }) => !existsSync(r.install_dir) || (!!r.uninstalled_at && (!r.exe || !existsSync(r.exe)));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class AchievementService {
  readonly events = new EventEmitter<{ unlock: [UnlockEvent]; changed: [string]; complete: [CompleteEvent] }>();
  private watching = new Map<string, { files: string[]; stop: () => void }>();
  private busy = new Map<string, Promise<number[]>>();

  constructor(private db: DB, private appData: string) {}

  isRunning: (id: string) => boolean = () => false;

  private row(id: string) {
    const r = this.db.prepare(`${GAME_SQL} WHERE g.id = ?`).get(id) as GameRow | undefined;
    if (!r) throw new Error(tt('jogo não encontrado'));
    return r;
  }
  private toGame(r: GameRow): InstalledGame {
    const adapter = adapterById(r.adapter);
    const c = adapter ? this.db.prepare(`SELECT (SELECT COUNT(*) FROM achievement_def WHERE game_id = ?) total,
      (SELECT COUNT(*) FROM achievement_unlock WHERE game_id = ?) unlocked,
      (SELECT COUNT(*) FROM achievement_def WHERE game_id = ? AND sort < ?) listed,
      (SELECT COUNT(*) FROM achievement_def d WHERE d.game_id = ? AND EXISTS (SELECT 1 FROM achievement_unlock u WHERE u.game_id = d.game_id AND u.ach_id = d.ach_id)) got`)
      .get(r.id, r.id, r.id, AUTO_SORT, r.id) as { total: number; unlocked: number; listed: number; got: number } : null;
    // 100% = cada conquista da lista desbloqueada, e só com a lista de verdade: quando só se conhecem as já vistas, "todas" seria mentira.
    const counts = c ? { total: c.total, unlocked: c.unlocked, complete: c.listed > 0 && c.total > 0 && c.got >= c.total } : null;
    return {
      id: r.id, title: r.title, console: r.console as ConsoleId, platformName: r.platform_name ?? null, installDir: r.install_dir, adapter: r.adapter, adapterLabel: adapter?.label ?? null,
      catalogId: r.catalog_id, coverUrl: absUrl(r.cover_url), addedAt: r.added_at, achievements: counts,
      exe: r.exe, sourceRepo: isSelfInstall(r.console) ? null : r.source_repo, version: r.version, managed: !!r.managed,
      playMs: r.play_ms ?? 0, lastPlayed: r.last_played ?? null, running: this.isRunning(r.id), ...((gone: boolean) => ({ missing: gone, uninstalled: gone && !!r.uninstalled_at }))(isGone(r)),
    };
  }
  private ctx(r: GameRow): AdapterContext {
    const appData = process.platform === 'linux' ? windowsAppData(r.install_dir, r.exe, r.id, readPatch(this.db, r.id).prefixPath) ?? this.appData : this.appData;
    return { installDir: r.install_dir, appData, title: r.title, repo: r.source_repo ?? r.catalog_repo ?? null };
  }

  listGames(): InstalledGame[] {
    return (this.db.prepare(`${GAME_SQL} WHERE g.hidden_at IS NULL ORDER BY g.title`).all() as GameRow[]).map(r => this.toGame(r));
  }
  getGame(id: string) { return this.toGame(this.row(id)); }
  internals(id: string) {
    const r = this.db.prepare('SELECT release_json, manifest_json FROM installed_game WHERE id = ?').get(id) as { release_json: string | null; manifest_json: string | null } | undefined;
    return { release: r?.release_json ? JSON.parse(r.release_json) as InstalledRelease : null, manifest: r?.manifest_json ? JSON.parse(r.manifest_json) as Record<string, number> : null };
  }
  addEmulated({ title, console, exe }: { title: string; console: string; exe: string }) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO installed_game (id, catalog_id, title, console, install_dir, adapter, added_at, exe, source_repo, release_json, version, managed, manifest_json)
      VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, 0, NULL)`).run(id, title, console, dirname(exe), Date.now(), exe);
    this.events.emit('changed', id);
    return this.toGame(this.row(id));
  }

  patchGame(id: string, p: { exe?: string | null; sourceRepo?: string | null; release?: InstalledRelease | null; manifest?: Record<string, number> | null; title?: string; console?: string }) {
    const sets: string[] = [], args: (string | null)[] = [];
    if (p.exe !== undefined) { sets.push('exe = ?'); args.push(p.exe); }
    if (p.sourceRepo !== undefined) { sets.push('source_repo = ?'); args.push(p.sourceRepo); }
    if (p.release !== undefined) { sets.push('release_json = ?', 'version = ?'); args.push(p.release ? JSON.stringify(p.release) : null, p.release?.tag ?? null); }
    if (p.manifest !== undefined) { sets.push('manifest_json = ?'); args.push(p.manifest ? JSON.stringify(p.manifest) : null); }
    if (p.title !== undefined) { sets.push('title = ?'); args.push(p.title); }
    if (p.console !== undefined) { sets.push('console = ?'); args.push(p.console); }
    if (sets.length) this.db.prepare(`UPDATE installed_game SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    this.events.emit('changed', id);
  }

  private matchCatalog(adapter: Adapter, dir: string) {
    const rows = adapter.repos.flatMap(name => this.db.prepare(`SELECT id, title, console, repo FROM catalog_game WHERE retired = 0 AND (lower(repo) = ? OR lower(repo) LIKE ?)`)
      .all(name, `%/${name}`) as { id: string; title: string; console: string; repo: string | null }[]);
    if (rows.length <= 1) return rows[0] ?? null;
    const folder = basename(dir).toLowerCase();
    const wants2 = /2/.test(folder);
    return rows.find(r => /\b2\b/.test(r.title) === wants2) ?? rows[0]!;
  }

  relocate(id: string, dir: string, p: { exe?: string | null; release?: InstalledRelease | null; manifest?: Record<string, number> | null; managed?: boolean } = {}) {
    dir = resolve(dir);
    const other = this.db.prepare('SELECT id, title FROM installed_game WHERE install_dir = ? AND id != ?').get(dir, id) as { id: string; title: string } | undefined;
    if (other) throw new Error(tt('Essa pasta já é de {0}. Escolha outra pasta, ou troque a pasta de {1} antes.', { 0: other.title, 1: other.title }));
    const r = this.row(id);
    let exe = p.exe ?? null;
    if (!exe) try { exe = findGameExe(dir) ?? guessProgram(dir, r.source_repo); } catch { exe = null; }
    this.unwatch(id);
    const back = !!r.uninstalled_at || !!r.hidden_at;
    const keys = [...new Set([...matchKeys(dir, exe), ...keysOf(r)])];
    this.db.prepare('UPDATE installed_game SET install_dir = ?, exe = ?, uninstalled_at = NULL, hidden_at = NULL, match_keys = ? WHERE id = ?').run(dir, exe, JSON.stringify(keys), id);
    if (p.managed !== undefined) this.db.prepare('UPDATE installed_game SET managed = ? WHERE id = ?').run(p.managed ? 1 : 0, id);
    // Voltou depois de desinstalado: o crack pode ser outro, então confere de novo qual leitor de conquistas serve.
    const found = back ? this.pickAdapter(dir, r.source_repo ?? r.catalog_repo ?? null) : null;
    if (found && found.id !== r.adapter) this.db.prepare('UPDATE installed_game SET adapter = ? WHERE id = ?').run(found.id, id);
    this.patchGame(id, { ...(p.release !== undefined ? { release: p.release } : {}), ...(p.manifest !== undefined ? { manifest: p.manifest } : {}) });
    if (found ?? adapterById(r.adapter)) {
      if (back) void (async () => {
        if (!this.db.prepare('SELECT 1 FROM achievement_def WHERE game_id = ? AND sort < ? LIMIT 1').get(id, AUTO_SORT)) await this.syncDefinitions(id);
        await this.syncUnlocks(id, { silent: true }).catch(() => {});
        this.events.emit('changed', id);
      })();
      this.watch(id);
    }
    return this.toGame(this.row(id));
  }

  async addGame(dir: string, extra: AddExtra = {}): Promise<InstalledGame> {
    dir = resolve(dir);
    const dup = this.db.prepare('SELECT id, title, catalog_id FROM installed_game WHERE install_dir = ?').get(dir) as { id: string; title: string; catalog_id: string | null } | undefined;
    if (dup && extra.catalogId && dup.catalog_id !== extra.catalogId) throw new Error(tt('Essa pasta já é de {0}. Escolha outra pasta, ou troque a pasta de {1} antes.', { 0: dup.title, 1: dup.title }));
    const again = { exe: extra.exe, release: extra.release, manifest: extra.manifest, managed: extra.managed };
    if (dup) return this.db.prepare('SELECT 1 FROM installed_game WHERE id = ? AND (uninstalled_at IS NOT NULL OR hidden_at IS NOT NULL)').get(dup.id) ? this.relocate(dup.id, dir, again) : this.toGame(this.row(dup.id));
    const lost = extra.catalogId ? (this.db.prepare('SELECT id, install_dir, exe, uninstalled_at, hidden_at FROM installed_game WHERE catalog_id = ?').all(extra.catalogId) as GameRow[]).find(x => isGone(x) || !!x.hidden_at) : undefined;
    if (lost) return this.relocate(lost.id, dir, again);
    // Reinstalado (ou achado em outra pasta): reconhece pelo appid, id da GOG ou nome do .exe e continua de onde parou.
    let exe0 = extra.exe ?? null;
    if (!exe0) try { exe0 = findGameExe(dir); } catch { }
    const keys = new Set(matchKeys(dir, exe0));
    if (keys.size && !extra.catalogId) {
      const old = (this.db.prepare('SELECT id, install_dir, exe, uninstalled_at, match_keys, hidden_at FROM installed_game WHERE match_keys IS NOT NULL ORDER BY uninstalled_at DESC').all() as GameRow[])
        .find(x => (isGone(x) || !!x.hidden_at) && keysOf(x).some(k => keys.has(k)));
      if (old) return this.relocate(old.id, dir, again);
    }
    let adapter = adapterForDir(dir);
    const cat = extra.catalogId
      ? this.db.prepare('SELECT id, title, console, repo FROM catalog_game WHERE id = ?').get(extra.catalogId) as { id: string; title: string; console: string; repo: string | null } | undefined
      : adapter ? this.matchCatalog(adapter, dir) : null;
    let exe = extra.exe ?? null;
    if (!exe) try { exe = findGameExe(dir) ?? guessProgram(dir, extra.sourceRepo ?? cat?.repo ?? null); } catch { exe = null; }
    // O índice de conquistas manda quando o projeto está nele (e nenhum leitor específico reconheceu a pasta).
    if ((!adapter || adapter.id === 'recomp-local') && entradaDo(extra.sourceRepo ?? cat?.repo)) adapter = indiceAdapter;
    const id = randomUUID();
    const keyList = matchKeys(dir, exe);
    this.db.prepare(`INSERT INTO installed_game (id, catalog_id, title, console, install_dir, adapter, added_at, exe, source_repo, release_json, version, managed, manifest_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, cat?.id ?? null, extra.title ?? cat?.title ?? adapter?.label ?? steamManifest(dir, exe)?.name ?? basename(dir),
      extra.console ?? cat?.console ?? (adapter ? ADAPTER_CONSOLE[adapter.id] : 'other') ?? 'other', dir, adapter?.id ?? null, Date.now(),
      exe, extra.sourceRepo ?? cat?.repo ?? null, extra.release ? JSON.stringify(extra.release) : null, extra.release?.tag ?? null,
      extra.managed ? 1 : 0, extra.manifest ? JSON.stringify(extra.manifest) : null);
    if (keyList.length) this.db.prepare('UPDATE installed_game SET match_keys = ? WHERE id = ?').run(JSON.stringify(keyList), id);
    if (adapter) {
      await this.syncDefinitions(id);
      await this.syncUnlocks(id, { silent: true });
      this.watch(id);
    }
    return this.toGame(this.row(id));
  }

  private pickAdapter(dir: string, repo: string | null): Adapter | null {
    let a: Adapter | null = null;
    try { a = adapterForDir(dir); } catch { }
    if ((!a || a.id === 'recomp-local') && entradaDo(repo)) a = indiceAdapter;
    return a;
  }

  /** Anota como reconhecer o jogo depois (chamar antes de apagar os arquivos: o appid some junto com eles). */
  rememberKeys(id: string) {
    const r = this.row(id);
    const keys = [...new Set([...keysOf(r), ...(existsSync(r.install_dir) ? matchKeys(r.install_dir, r.exe) : [])])];
    this.db.prepare('UPDATE installed_game SET match_keys = ? WHERE id = ?').run(keys.length ? JSON.stringify(keys) : null, id);
  }
  /** Desinstalado: sai do disco mas fica na biblioteca, com tempo de jogo e conquistas. */
  markUninstalled(id: string) {
    this.unwatch(id);
    this.db.prepare('UPDATE installed_game SET uninstalled_at = ? WHERE id = ?').run(Date.now(), id);
    this.events.emit('changed', id);
  }
  /** Some da biblioteca guardando tudo; volta com o histórico se o jogo for instalado (ou adicionado) de novo. */
  hideGame(id: string) {
    this.rememberKeys(id);
    this.unwatch(id);
    this.db.prepare('UPDATE installed_game SET hidden_at = ? WHERE id = ?').run(Date.now(), id);
    this.events.emit('changed', id);
  }
  /** Pastas de saves e conquistas do crack que existem fora da pasta do jogo (as que "apagar tudo" manda para a Lixeira). */
  saveDirs(id: string): string[] {
    const r = this.row(id);
    const ids = new Set(keysOf(r).filter(k => k.startsWith('steam:')).map(k => k.slice(6)));
    if (existsSync(r.install_dir)) { try { const a = scanCrack(r.install_dir)?.appid; if (a) ids.add(a); } catch { } }
    const appData = this.ctx(r).appData;
    return [...ids].flatMap(a => crackSaveDirs(appData, a));
  }

  removeGame(id: string) {
    this.unwatch(id);
    tx(this.db, () => {
      for (const t of ['achievement_unlock', 'achievement_def', 'play_session']) this.db.prepare(`DELETE FROM ${t} WHERE game_id = ?`).run(id);
      this.db.prepare('DELETE FROM installed_game WHERE id = ?').run(id);
      this.db.prepare("DELETE FROM kv WHERE key LIKE ?").run(`ach.%.${id}`);
    });
  }

  async syncDefinitions(id: string) {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter) return;
    try {
      const defs = await adapter.definitions(this.ctx(r));
      const ins = this.db.prepare('INSERT INTO achievement_def (game_id, ach_id, name, description, points, image, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
      tx(this.db, () => {
        this.db.prepare('DELETE FROM achievement_def WHERE game_id = ?').run(id);
        defs.list.forEach((a, i) => ins.run(id, a.id, a.name, a.description, a.points, defs.images?.get(a.id) ?? null, i));
      });
      kvSet(this.db, `ach.origin.${id}`, defs.origin);
      await this.syncRarity(id);
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.defError.${id}`);
    } catch (e) {
      kvSet(this.db, `ach.defError.${id}`, tt('Não consegui ler a lista de conquistas: {0}', { 0: msg(e) }));
    }
  }

  syncUnlocks(id: string, opts: { silent?: boolean } = {}): Promise<number[]> {
    const prev = this.busy.get(id) ?? Promise.resolve([]);
    const next = prev.catch(() => []).then(() => this.doSyncUnlocks(id, opts));
    this.busy.set(id, next);
    return next;
  }

  private async doSyncUnlocks(id: string, opts: { silent?: boolean }): Promise<number[]> {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter) return [];
    const ctx = this.ctx(r);
    let unlocks: Unlock[] | null = null, lastErr: unknown;
    if (adapter.remote) {
      try { unlocks = await adapter.remote(ctx); } catch (e) { lastErr = e; }
    } else {
      const file = adapter.unlockFile(ctx);
      if (!file || !existsSync(file)) { this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`); return []; }
      for (let i = 0; i < 4 && !unlocks; i++) {
        try { unlocks = adapter.readUnlocks(new Uint8Array(await readFile(file)), ctx); }
        catch (e) { lastErr = e; await sleep(250 * (i + 1)); }
      }
    }
    if (!unlocks) { kvSet(this.db, `ach.unlockError.${id}`, tt('Não consegui ler os desbloqueios: {0}', { 0: msg(lastErr) })); return []; }
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`);

    const now = Date.now(), fresh: number[] = [];
    const have = new Map((this.db.prepare('SELECT ach_id, unlocked_at FROM achievement_unlock WHERE game_id = ?').all(id) as { ach_id: number; unlocked_at: number | null }[]).map(u => [u.ach_id, u.unlocked_at]));
    const ins = this.db.prepare('INSERT INTO achievement_unlock (game_id, ach_id, unlocked_at, seen_at) VALUES (?, ?, ?, ?)');
    const fix = this.db.prepare('UPDATE achievement_unlock SET unlocked_at = ? WHERE game_id = ? AND ach_id = ?');
    const known = new Set((this.db.prepare('SELECT ach_id FROM achievement_def WHERE game_id = ?').all(id) as { ach_id: number }[]).map(d => d.ach_id));
    const addDef = this.db.prepare('INSERT INTO achievement_def (game_id, ach_id, name, description, points, image, sort) VALUES (?, ?, ?, ?, NULL, NULL, ?)');
    tx(this.db, () => {
      for (const u of unlocks!) {
        if (!have.has(u.id)) { ins.run(id, u.id, u.at, now); fresh.push(u.id); }
        else if (have.get(u.id) == null && u.at != null) fix.run(u.at, id, u.id);
        if (u.name && !known.has(u.id)) { addDef.run(id, u.id, humanize(u.name, n => tt('Conquista {0}', { 0: n })), '', AUTO_SORT + known.size); known.add(u.id); }
      }
    });

    let announced = false;
    if (fresh.length) {
      this.events.emit('changed', id);
      if (!opts.silent) {
        const def = this.db.prepare('SELECT name, description, points, image FROM achievement_def WHERE game_id = ? AND ach_id = ?');
        const rare = await this.rarityFor(id, fresh.some(a => { const at = unlocks!.find(u => u.id === a)?.at; return at == null || now - at <= 15 * 60_000; }));
        for (const achId of fresh) {
          // Conquistas antigas que aparecem agora (importadas) entram caladas; só avisa o que acabou de acontecer.
          const at = unlocks.find(u => u.id === achId)?.at ?? null;
          if (at != null && now - at > 15 * 60_000) continue;
          const d = def.get(id, achId) as { name: string; description: string; points: number | null; image: Uint8Array | null } | undefined;
          this.events.emit('unlock', { gameId: id, gameTitle: r.title, achId, name: d?.name ?? tt('Conquista #{0}', { 0: achId }), description: d?.description ?? '', points: d?.points ?? null,
            icon: d?.image ? `data:${imgType(d.image)};base64,${Buffer.from(d.image).toString('base64')}` : null, at: at ?? now, rarity: rare[achId] ?? null });
          announced = true;
        }
      }
      // Fechou os 100% agora (com uma conquista que acabou de sair): comemora uma vez por jogo.
      const g = this.toGame(this.row(id));
      if (g.achievements?.complete && !kvGet(this.db, `ach.platina.${id}`)) {
        kvSet(this.db, `ach.platina.${id}`, String(now));
        if (announced) this.events.emit('complete', { gameId: id, gameTitle: g.title, console: g.console, platformName: g.platformName, coverUrl: g.coverUrl, total: g.achievements.total, at: now });
      }
      // Ganhou conquistas novas (DLC, lista atualizada): quando fechar de novo, comemora de novo.
      else if (!g.achievements?.complete && kvGet(this.db, `ach.platina.${id}`)) kvSet(this.db, `ach.platina.${id}`, '');
    }
    return fresh;
  }

  watch(id: string) {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter || this.watching.has(id)) return;
    const ctx = this.ctx(r);
    if (adapter.remote) {
      // Da internet: confere a cada 5 minutos com o jogo aberto, e quando ele fecha (pelo index).
      const t = setInterval(() => { if (this.isRunning(id)) void this.syncUnlocks(id).catch(() => {}); }, 5 * 60_000);
      t.unref?.();
      this.watching.set(id, { files: [], stop: () => clearInterval(t) });
      return;
    }
    const files = [...new Set([adapter.unlockFile(ctx), ...(adapter.watchFiles?.(ctx) ?? [])].filter(Boolean))];
    let timer: NodeJS.Timeout | undefined;
    const on = () => { clearTimeout(timer); timer = setTimeout(() => { void this.syncUnlocks(id).catch(() => {}); }, 400); };
    for (const f of files) watchFile(f, { interval: 1500, persistent: false }, on);
    this.watching.set(id, { files, stop: () => { clearTimeout(timer); for (const f of files) unwatchFile(f, on); } });
  }
  unwatch(id: string) {
    const w = this.watching.get(id);
    if (w) { w.stop(); this.watching.delete(id); }
  }
  /** Jogos que já estavam na biblioteca ganham leitor quando um novo serve para eles. */
  private detectAdapters() {
    const rows = this.db.prepare(`SELECT g.id, g.install_dir, g.adapter, COALESCE(g.source_repo, c.repo) repo FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id
      WHERE g.adapter IS NULL OR g.adapter IN ('recomp-local', 'indice')`).all() as { id: string; install_dir: string; adapter: string | null; repo: string | null }[];
    for (const r of rows) {
      if (!existsSync(r.install_dir)) continue;
      let a: Adapter | null = entradaDo(r.repo) ? indiceAdapter : null;
      if (!a && r.adapter !== 'recomp-local') try { a = adapterForDir(r.install_dir); } catch { }
      if (!a && r.adapter === 'indice') a = adapterForDir(r.install_dir);
      if ((a?.id ?? null) !== r.adapter && (a || r.adapter === 'indice')) { this.unwatch(r.id); this.db.prepare('UPDATE installed_game SET adapter = ? WHERE id = ?').run(a?.id ?? null, r.id); }
    }
  }
  /** Índice de conquistas: a cópia guardada na hora, a mais nova da internet quando chegar (em até 8 s). */
  private async loadIndice() {
    try { const v = validar(JSON.parse(kvGet(this.db, 'ach.indice') ?? 'null')); if (v?.jogos.length) usarIndice(v); } catch { }
    const novo = await Promise.race([atualizarIndice(), sleep(8000).then(() => null)]).catch(() => null);
    if (novo?.jogos.length) kvSet(this.db, 'ach.indice', JSON.stringify(novo));
  }
  /** Porcentagens guardadas; sem nenhuma ainda e com conquista para avisar, tenta buscar agora (até 4 s). */
  private async rarityFor(id: string, announcing: boolean): Promise<Record<string, number>> {
    const read = () => { try { return JSON.parse(kvGet(this.db, `ach.rarity.${id}`) ?? '{}') as Record<string, number>; } catch { return {}; } };
    let m = read();
    if (announcing && !Object.keys(m).length && adapterById(this.row(id).adapter)?.rarity) {
      await Promise.race([this.syncRarity(id), sleep(4000)]);
      m = read();
    }
    return m;
  }
  /** Busca a porcentagem de jogadores de cada conquista (quando a origem publica) e guarda. */
  async syncRarity(id: string) {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter?.rarity) return;
    try {
      const m = await adapter.rarity(this.ctx(r));
      if (m?.size) { kvSet(this.db, `ach.rarity.${id}`, JSON.stringify(Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 10) / 10])))); kvSet(this.db, `ach.rarityAt.${id}`, String(Date.now())); }
    } catch { }
  }
  /** Relê lista e desbloqueios dos jogos com esses leitores (depois de pôr a chave da Steam ou entrar na GOG). */
  async resyncKind(kinds: string[]) {
    for (const g of this.listGames()) {
      if (!g.adapter || !kinds.includes(g.adapter) || g.missing) continue;
      await this.syncDefinitions(g.id);
      await this.syncUnlocks(g.id, { silent: true }).catch(() => {});
      this.watch(g.id);
      this.events.emit('changed', g.id);
    }
  }
  /** Confere os desbloqueios de um jogo que veio da internet (chamado quando o jogo fecha). */
  async refreshRemote(id: string) {
    let r; try { r = this.row(id); } catch { return; }
    if (adapterById(r.adapter)?.remote) await this.syncUnlocks(id).catch(() => {});
  }
  async start() {
    for (const r of this.db.prepare('SELECT id, title, install_dir, exe FROM installed_game WHERE catalog_id IS NULL').all() as { id: string; title: string; install_dir: string; exe: string | null }[]) {
      if (r.title.toLowerCase() !== basename(r.install_dir).toLowerCase()) continue;
      const name = steamManifest(r.install_dir, r.exe)?.name;
      if (name && name !== r.title) this.db.prepare('UPDATE installed_game SET title = ? WHERE id = ?').run(name, r.id);
    }
    for (const r of this.db.prepare(`SELECT g.id, g.install_dir, g.exe, g.source_repo, c.repo FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id
        WHERE g.exe IS NULL OR (g.source_repo IS NULL AND c.repo IS NOT NULL)`).all() as { id: string; install_dir: string; exe: string | null; source_repo: string | null; repo: string | null }[]) {
      let exe = r.exe;
      if (!exe) try { exe = findGameExe(r.install_dir) ?? guessProgram(r.install_dir, r.repo); } catch {  }
      this.db.prepare('UPDATE installed_game SET exe = ?, source_repo = COALESCE(source_repo, ?) WHERE id = ?').run(exe, r.repo, r.id);
    }
    await this.loadIndice();
    this.detectAdapters();
    for (const g of this.listGames()) {
      if (!g.adapter || g.missing) continue;
      // Sem a lista do jogo (nenhuma conquista vinda dela, só as conhecidas pelo desbloqueio): tenta buscar de novo.
      if (adapterById(g.adapter)?.refreshDefs || !this.db.prepare('SELECT 1 FROM achievement_def WHERE game_id = ? AND sort < ? LIMIT 1').get(g.id, AUTO_SORT)) await this.syncDefinitions(g.id);
      if (Date.now() - Number(kvGet(this.db, `ach.rarityAt.${g.id}`) ?? 0) > 3 * 86400_000) await this.syncRarity(g.id);
      const first = !this.db.prepare('SELECT 1 FROM achievement_unlock WHERE game_id = ? LIMIT 1').get(g.id);
      await this.syncUnlocks(g.id, { silent: first }).catch(() => {});
      this.watch(g.id);
    }
  }
  stop() { for (const id of [...this.watching.keys()]) this.unwatch(id); }

  /** Conquistas recentes, como notificações: somem sozinhas depois de FEED_DAYS dias ou quando a pessoa apaga. */
  recentUnlocks(limit = 8): RecentUnlock[] {
    const since = Date.now() - FEED_DAYS * 86400_000, hidden = this.hiddenFeed();
    return (this.db.prepare(`SELECT u.game_id, g.title game, u.ach_id, COALESCE(d.name, 'Conquista #' || u.ach_id) name, d.points, d.image, COALESCE(u.unlocked_at, u.seen_at) at
      FROM achievement_unlock u JOIN installed_game g ON g.id = u.game_id LEFT JOIN achievement_def d ON d.game_id = u.game_id AND d.ach_id = u.ach_id
      WHERE COALESCE(u.unlocked_at, u.seen_at) >= ? ORDER BY at DESC LIMIT ?`).all(since, limit + hidden.size) as { game_id: string; game: string; ach_id: number; name: string; points: number | null; image: Uint8Array | null; at: number }[])
      .filter(r => !hidden.has(`${r.game_id}:${r.ach_id}`)).slice(0, limit)
      .map(r => ({ gameId: r.game_id, gameTitle: r.game, achId: r.ach_id, name: r.name, points: r.points, at: r.at, icon: r.image ? `data:${imgType(r.image)};base64,${Buffer.from(r.image).toString('base64')}` : null }));
  }
  private hiddenFeed() { try { return new Set(JSON.parse(kvGet(this.db, 'ach.feed.hidden') ?? '[]') as string[]); } catch { return new Set<string>(); } }
  /** Tira conquistas da lista de recentes (todas, se nenhuma for passada). Elas continuam desbloqueadas no jogo. */
  dismissRecent(keys?: { gameId: string; achId: number }[]) {
    const since = Date.now() - FEED_DAYS * 86400_000;
    const live = new Set((this.db.prepare('SELECT game_id, ach_id FROM achievement_unlock WHERE COALESCE(unlocked_at, seen_at) >= ?').all(since) as { game_id: string; ach_id: number }[]).map(r => `${r.game_id}:${r.ach_id}`));
    const set = new Set([...this.hiddenFeed()].filter(k => live.has(k)));
    for (const k of keys ?? [...live].map(x => ({ gameId: x.split(':')[0]!, achId: Number(x.split(':')[1]) }))) set.add(`${k.gameId}:${k.achId}`);
    kvSet(this.db, 'ach.feed.hidden', JSON.stringify([...set]));
  }

  totals() {
    return this.db.prepare(`SELECT (SELECT COUNT(*) FROM achievement_unlock) unlocked, (SELECT COUNT(*) FROM achievement_def) total`).get() as { unlocked: number; total: number };
  }

  async resync(id: string) { await this.syncDefinitions(id); await this.syncUnlocks(id); return this.forGame(id); }

  forGame(id: string): GameAchievements {
    const r = this.row(id), adapter = adapterById(r.adapter);
    const defs = this.db.prepare('SELECT ach_id, name, description, points, image, sort FROM achievement_def WHERE game_id = ? ORDER BY sort').all(id) as
      { ach_id: number; name: string; description: string; points: number | null; image: Uint8Array | null; sort: number }[];
    const unlocks = new Map((this.db.prepare('SELECT ach_id, COALESCE(unlocked_at, seen_at) at FROM achievement_unlock WHERE game_id = ?').all(id) as { ach_id: number; at: number }[]).map(u => [u.ach_id, u.at]));
    let rare: Record<string, number> = {};
    try { rare = JSON.parse(kvGet(this.db, `ach.rarity.${id}`) ?? '{}') as Record<string, number>; } catch { }
    const list = defs.map(d => ({
      id: d.ach_id, name: d.name, description: d.description, points: d.points, unlockedAt: unlocks.get(d.ach_id) ?? null, rarity: rare[d.ach_id] ?? null,
      icon: d.image ? `data:${imgType(d.image)};base64,${Buffer.from(d.image).toString('base64')}` : null,
    }));
    const known = new Set(defs.map(d => d.ach_id));
    for (const [achId, at] of unlocks) if (!known.has(achId)) list.push({ id: achId, name: tt('Conquista #{0}', { 0: achId }), description: '', points: null, unlockedAt: at, icon: null, rarity: null });
    const errors = [kvGet(this.db, `ach.defError.${id}`), kvGet(this.db, `ach.unlockError.${id}`)].filter((e): e is string => !!e);
    return { complete: defs.some(d => d.sort < AUTO_SORT), game: this.toGame(r), origin: kvGet(this.db, `ach.origin.${id}`), unlockFile: adapter ? adapter.unlockFile(this.ctx(r)) || null : null, errors, list };
  }
}
