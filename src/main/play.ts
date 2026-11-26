import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, chmodSync, closeSync, constants, existsSync, openSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';
import type { InstallProgress, PlayEvent, PlayStats } from '@shared/types';
import type { DB } from './db';
import type { AchievementService } from './achievements/service';
import { emulatorFor } from './emulators';
import { tt } from '@shared/i18n';
import { log } from './log';
import { steamManifest } from './steam';
import { prepareWindows } from './wine/launch';

export class Player {
  readonly events = new EventEmitter<{ play: [PlayEvent]; launch: [{ gameId: string; dirs: string[]; pid?: number }]; progress: [InstallProgress] }>();
  private running = new Map<string, Run>();
  private preparing = new Set<string>();
  private external = new Map<string, { pid: number; session: number; start: number }>();
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(private db: DB, private games: AchievementService, private openPath: (p: string) => Promise<string>, private onExit: () => void = () => {}, private procs: () => Promise<Proc[]> = processTable) {
    db.prepare('UPDATE play_session SET ended_at = started_at WHERE ended_at IS NULL').run();
  }

  private emu = new Map<number, { title: string; gameId: string | null; session: number; start: number }>();
  private resolveEmu: ((exe: string, title: string) => Promise<string | null>) | null = null;
  setEmulatorResolver(f: (exe: string, title: string) => Promise<string | null>) { this.resolveEmu = f; }

  current(): { id: string; title: string; start: number } | null {
    const pick = (id: string, start: number) => { try { return { id, title: this.games.getGame(id).title, start }; } catch { return null; } };
    for (const [id, r] of this.running) return pick(id, r.start);
    for (const [id, r] of this.external) return pick(id, r.start);
    for (const r of this.emu.values()) if (r.gameId) return pick(r.gameId, r.start);
    return null;
  }

  isRunning = (id: string) => this.running.has(id) || this.external.has(id) || [...this.emu.values()].some(e => e.gameId === id);

  private async env() {
    if (process.platform !== 'win32') return process.env;
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH']).catch(() => '');
    return out.toLowerCase().includes('steam.exe') ? { ...process.env, SDL_JOYSTICK_HIDAPI_STEAM: '0' } : process.env;
  }

  async play(gameId: string) {
    const g = this.games.getGame(gameId);
    if (this.running.has(gameId)) throw new Error(tt('{0} já está aberto.', { 0: g.title }));
    if (!g.exe) throw new Error(tt('Ainda não sei qual programa abre este jogo. Use "Escolher o .exe".'));
    if (!existsSync(g.exe)) throw new Error(tt('{0} não está mais lá. O jogo foi movido ou apagado?', { 0: basename(g.exe) }));

    const isProgram = process.platform === 'win32' ? /\.exe$/i.test(g.exe) : true;
    if (!isProgram) {
      const err = await this.openPath(g.exe);
      if (err) throw new Error(tt('Não consegui abrir {0}: {1}', { 0: basename(g.exe), 1: err }));
      const now = Date.now();
      this.db.prepare('INSERT INTO play_session (game_id, started_at, ended_at) VALUES (?, ?, ?)').run(gameId, now, now);
      this.events.emit('play', { gameId, title: g.title, running: false, sessionMs: 0 });
      this.events.emit('launch', { gameId, dirs: [g.installDir].filter(Boolean) });
      return;
    }

    let cmd = g.exe, args: string[] = [], extraEnv: Record<string, string> = {}, logFile: string | null = null;
    if (process.platform === 'linux') {
      if (/\.(exe|bat|cmd|lnk)$/i.test(g.exe)) {
        const steam = /\.exe$/i.test(g.exe) ? steamManifest(g.installDir, g.exe) : null;
        if (steam) {
          const err = await run('xdg-open', [`steam://rungameid/${steam.appid}`], 15_000).then(() => '', e => (e instanceof Error ? e.message : String(e)));
          if (err) throw new Error(tt('Não consegui pedir para a Steam abrir {0}: {1}', { 0: g.title, 1: err }));
          this.trackDetached(gameId, g.title, g.exe, g.installDir, 30);
          return;
        }
        if (this.preparing.has(gameId)) throw new Error(tt('{0} já está abrindo.', { 0: g.title }));
        const note = (stage: string, pct: number) => this.events.emit('progress', { key: gameId, stage, pct });
        this.preparing.add(gameId);
        try {
          const w = await prepareWindows(this.db, gameId, g.title, g.exe, note, m => log(`${g.title}: ${m}`));
          cmd = w.cmd; args = w.args; extraEnv = w.env; logFile = w.logFile;
          log(`${g.title}: programa do Windows aberto pelo ${w.how}`);
          this.events.emit('progress', { key: gameId, stage: tt('Pronto'), pct: 1, done: true });
        } catch (e) {
          this.events.emit('progress', { key: gameId, stage: tt('Erro'), pct: 0, done: true, error: (e as Error).message });
          throw e;
        } finally { this.preparing.delete(gameId); }
      } else {
        try { accessSync(g.exe, constants.X_OK); } catch { try { chmodSync(g.exe, 0o755); } catch { } }
      }
    }

    const env = { ...(await this.env()), ...extraEnv };
    const fd = logFile ? openSync(logFile, 'a') : -1;
    const denied = await new Promise<boolean>((ok, fail) => {
      const child = spawn(cmd, args, { cwd: dirname(g.exe!), env, detached: true, stdio: fd >= 0 ? ['ignore', fd, fd] : 'ignore' });
      child.once('error', e => {
        if (fd >= 0) closeSync(fd);
        if ((e as NodeJS.ErrnoException).code === 'EACCES' && process.platform === 'win32') ok(true);
        else fail(new Error(tt('Não consegui abrir o jogo: {0}', { 0: e.message })));
      });
      child.once('spawn', () => {
        if (fd >= 0) closeSync(fd);
        const start = Date.now();
        const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
        this.running.set(gameId, { child, session, start });
        child.unref();
        this.events.emit('play', { gameId, title: g.title, running: true });
        this.events.emit('launch', { gameId, dirs: [...new Set([g.installDir, dirname(g.exe!)])].filter(Boolean), ...(child.pid ? { pid: child.pid } : {}) });
        child.once('exit', () => this.finish(gameId, child));
        ok(false);
      });
    });
    if (denied) await this.playElevated(gameId, g.title, g.exe, g.installDir);
  }

  private async playElevated(gameId: string, title: string, exe: string, installDir: string) {
    const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(dirname(exe))}`], 180_000);
    } catch {
      throw new Error(tt('O Windows não deixou abrir {0}. Se o jogo pede permissão de administrador, aceite o aviso do Windows; se o aviso não apareceu, veja se o antivírus bloqueou o arquivo.', { 0: basename(exe) }));
    }
    this.trackDetached(gameId, title, exe, installDir, 8);
  }

  private trackDetached(gameId: string, title: string, exe: string, installDir: string, tries: number) {
    const start = Date.now();
    const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
    const r: Run = { child: null, session, start };
    r.follow = { pids: new Set(), dirs: [...new Set([installDir, dirname(exe)])], names: [basename(exe)], exitAt: start, seenAt: 0, misses: 0, timer: null, tries };
    this.running.set(gameId, r);
    this.events.emit('play', { gameId, title, running: true });
    this.events.emit('launch', { gameId, dirs: r.follow.dirs.filter(Boolean) });
    this.followTick(gameId, r);
  }

  private finish(gameId: string, child: ChildProcess) {
    const r = this.running.get(gameId);
    if (!r || r.child !== child || r.follow) return;
    const now = Date.now();
    if (now - r.start < FOLLOW.window && child.pid) {
      let dirs: string[] = [];
      try { const g = this.games.getGame(gameId); dirs = [...new Set([g.installDir, dirname(g.exe ?? g.installDir)])]; } catch { }
      r.follow = { pids: new Set([child.pid]), dirs, names: [], exitAt: now, seenAt: 0, misses: 0, timer: null };
      this.followTick(gameId, r);
      return;
    }
    this.end(gameId, r, now);
  }

  private followTick(gameId: string, r: Run) {
    const f = r.follow!;
    f.timer = setTimeout(() => {
      void this.procs().then(table => {
        if (this.running.get(gameId) !== r) return;
        const alive = followAlive(table, f.pids, f.dirs, f.names);
        if (alive.length) { f.pids = new Set(alive); f.seenAt = Date.now(); f.misses = 0; return this.followTick(gameId, r); }
        if (f.seenAt) return this.end(gameId, r, Date.now());
        if (++f.misses >= (f.tries ?? FOLLOW.tries)) return this.end(gameId, r, f.exitAt);
        this.followTick(gameId, r);
      }, () => { if (this.running.get(gameId) === r) this.end(gameId, r, Date.now()); });
    }, FOLLOW.every);
  }

  private end(gameId: string, r: Run, end: number) {
    if (this.running.get(gameId) !== r) return;
    if (r.follow?.timer) clearTimeout(r.follow.timer);
    this.running.delete(gameId);
    this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
    let title = ''; try { title = this.games.getGame(gameId).title; } catch {  }
    this.events.emit('play', { gameId, title, running: false, sessionMs: end - r.start });
    this.onExit();
  }

  watchExternal(on: boolean) {
    if (process.platform !== 'win32' && process.platform !== 'linux') return;
    if (on && !this.scanTimer) { this.scanTimer = setInterval(() => void this.scan(), 5000); void this.scan(); }
    else if (!on && this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; this.endExternal(); for (const pid of [...this.emu.keys()]) this.endEmu(pid); }
  }

  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const table = process.platform === 'win32' ? null : await this.procs();
      const procs = table ? namesOf(table) : await listProcesses();
      const seen = new Set<string>();
      for (const g of this.games.listGames()) {
        if (!g.exe || !/\.exe$/i.test(g.exe) || this.running.has(g.id) || emulatorFor(g.exe)) continue;
        const pids = procs.get(basename(g.exe).toLowerCase());
        if (!pids?.length) continue;
        const cur = this.external.get(g.id);
        if (cur && pids.includes(cur.pid)) { seen.add(g.id); continue; }
        const paths = table ? pathsOf(table, pids) : await processPaths(pids);
        const want = normalize(g.exe).toLowerCase();
        const pid = pids.find(p => paths.get(p) === want);
        if (pid == null) continue;
        seen.add(g.id);
        if (cur) { cur.pid = pid; continue; }
        const start = Date.now();
        const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(g.id, start).lastInsertRowid);
        this.external.set(g.id, { pid, session, start });
        this.events.emit('play', { gameId: g.id, title: g.title, running: true });
      }
      for (const id of [...this.external.keys()]) if (!seen.has(id)) this.endExternal(id);
      await this.scanEmulators(procs);
    } catch { } finally { this.scanning = false; }
  }

  private async scanEmulators(procs: Map<string, number[]>) {
    const list = [...procs.entries()].filter(([n]) => emulatorFor(n)).flatMap(([, pids]) => pids);
    const launched = new Set([...this.running.values()].map(r => r.child?.pid).filter((p): p is number => !!p));
    const live = new Set<number>();
    if (list.length && this.resolveEmu) {
      const wins = await windowTitles(list);
      for (const pid of list) {
        const w = wins.get(pid);
        if (!w || launched.has(pid)) continue;
        live.add(pid);
        const cur = this.emu.get(pid);
        if (cur && cur.title === w.title) continue;
        const gameId = w.title ? await this.resolveEmu(w.path, w.title) : null;
        if (cur && cur.gameId === gameId) { cur.title = w.title; continue; }
        if (cur) this.endEmu(pid);
        if (gameId && !this.running.has(gameId) && !this.external.has(gameId) && ![...this.emu.values()].some(e => e.gameId === gameId)) {
          const start = Date.now();
          const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
          this.emu.set(pid, { title: w.title, gameId, session, start });
          let title = ''; try { title = this.games.getGame(gameId).title; } catch { }
          this.events.emit('play', { gameId, title, running: true });
        } else this.emu.set(pid, { title: w.title, gameId: null, session: 0, start: 0 });
      }
    }
    for (const pid of [...this.emu.keys()]) if (!live.has(pid)) this.endEmu(pid);
  }

  private endEmu(pid: number) {
    const r = this.emu.get(pid); if (!r) return;
    this.emu.delete(pid);
    if (!r.gameId) return;
    const end = Date.now();
    this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
    let title = ''; try { title = this.games.getGame(r.gameId).title; } catch { }
    this.events.emit('play', { gameId: r.gameId, title, running: false, sessionMs: end - r.start });
  }

  private endExternal(only?: string) {
    const end = Date.now();
    for (const [id, r] of [...this.external]) {
      if (only && id !== only) continue;
      this.external.delete(id);
      this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
      let title = ''; try { title = this.games.getGame(id).title; } catch { }
      this.events.emit('play', { gameId: id, title, running: false, sessionMs: end - r.start });
    }
  }

  quit(gameId: string) {
    const em = [...this.emu.entries()].find(([, e]) => e.gameId === gameId);
    if (em) { killTree(em[0]); return true; }
    const ext = this.external.get(gameId);
    if (ext) { try { spawn('taskkill', ['/pid', String(ext.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { } return true; }
    const r = this.running.get(gameId);
    if (r?.follow) {
      for (const pid of r.follow.pids) killTree(pid);
      return true;
    }
    const child = r?.child;
    if (!child?.pid) return false;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { try { child.kill(); } catch {  } }
    return true;
  }

  stop() {
    const now = Date.now();
    for (const r of this.running.values()) if (r.follow?.timer) clearTimeout(r.follow.timer);
    for (const r of this.running.values()) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.running.clear();
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    for (const r of this.external.values()) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.external.clear();
    for (const r of this.emu.values()) if (r.gameId) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.emu.clear();
  }

  stats(gameId?: string): PlayStats {
    const where = gameId ? 'WHERE game_id = ?' : '', args = gameId ? [gameId] : [];
    const now = Date.now();
    const all = this.db.prepare(`SELECT game_id g, started_at s, COALESCE(ended_at, ?) e FROM play_session ${where} ORDER BY game_id, started_at`)
      .all(now, ...args) as { g: string; s: number; e: number }[];
    const groups = mergeSessions(all);
    const totalMs = all.reduce((a, r) => a + Math.max(0, r.e - r.s), 0);
    const real = groups.filter(x => x.ms >= MIN_SESSION);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = today.getTime() - 13 * 86400_000;
    const days = Array(14).fill(0) as number[];
    for (const { s, e } of all) {
      if (e <= from) continue;
      for (let d = 0; d < 14; d++) {
        const a = from + d * 86400_000, b = a + 86400_000, ov = Math.min(e, b) - Math.max(s, a);
        if (ov > 0) days[d]! += ov / 3600_000;
      }
    }
    return {
      totalMs, sessions: groups.length, avgMs: real.length ? real.reduce((a, x) => a + x.ms, 0) / real.length : 0,
      lastPlayed: all.length ? all.reduce((a, r) => Math.max(a, r.s), 0) : null, days,
    };
  }
}

export const SESSION_GAP = 10 * 60_000, MIN_SESSION = 2 * 60_000;

export function mergeSessions(rows: { g: string; s: number; e: number }[]) {
  const out: { g: string; s: number; e: number; ms: number }[] = [];
  const sorted = [...rows].sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : a.s - b.s));
  for (const r of sorted) {
    const last = out[out.length - 1], ms = Math.max(0, r.e - r.s);
    if (last && last.g === r.g && r.s - last.e < SESSION_GAP) { last.e = Math.max(last.e, r.e); last.ms += ms; }
    else out.push({ g: r.g, s: r.s, e: r.e, ms });
  }
  return out;
}

interface Run {
  child: ChildProcess | null; session: number; start: number;
  follow?: { pids: Set<number>; dirs: string[]; names: string[]; exitAt: number; seenAt: number; misses: number; timer: NodeJS.Timeout | null; tries?: number };
}
export const FOLLOW = { window: 90_000, every: 4000, tries: 4 };

export interface Proc { pid: number; ppid: number; path: string; name?: string }

export function followAlive(table: Proc[], pids: Set<number>, dirs: string[], names: string[] = []) {
  const key = (x: string) => x.replace(/[\\/]+/g, '/').toLowerCase();
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const roots = dirs.filter(Boolean).map(d => key(d).replace(/\/$/, '') + '/');
  const tracked = new Set(pids), alive = new Set<number>();
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) {
      if (alive.has(p.pid) || p.pid === process.pid) continue;
      const inDir = !!p.path && roots.some(r => key(p.path).startsWith(r));
      const named = !!p.name && wanted.has(p.name.toLowerCase());
      if (tracked.has(p.pid) || tracked.has(p.ppid) || inDir || named) { alive.add(p.pid); if (!tracked.has(p.pid)) { tracked.add(p.pid); grew = true; } }
    }
  }
  return [...alive];
}

export function parseProcTable(out: string): Proc[] {
  const L: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\|(\d+)\|([^|]*)(?:\|(.*))?$/);
    if (m) L.push({ pid: Number(m[1]), ppid: Number(m[2]), path: m[3]!.trim(), ...(m[4] !== undefined ? { name: m[4].trim() } : {}) });
  }
  return L;
}

async function processTable(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    return parseProcTable(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_UTF8 + 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)|$($_.Name)" }']));
  }
  const L: Proc[] = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = readFileSync(`/proc/${d}/stat`, 'utf8'), ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
      let path = '', name = ''; try { path = readlinkSync(`/proc/${d}/exe`); } catch { }
      try { name = readFileSync(`/proc/${d}/comm`, 'utf8').trim(); } catch { }
      const win = /wine|proton/i.test(basename(path)) ? wineTarget(d) : null;
      if (win) { path = win; name = basename(win.replace(/\\/g, '/')); }
      L.push({ pid: Number(d), ppid, path, name });
    } catch { }
  }
  return L;
}

export function winePath(arg: string) {
  const a = arg.trim();
  if (/^[a-z]:[\\/]/i.test(a)) return /^z:/i.test(a) ? a.slice(2).replace(/\\/g, '/') : null;
  return a.startsWith('/') ? a : null;
}

function wineTarget(pid: string) {
  let args: string[] = [];
  try { args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return null; }
  for (const a of args) if (/\.exe$/i.test(a)) { const p = winePath(a); if (p) return p; }
  return null;
}

function killTree(pid: number) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { }
}

const PS_UTF8 = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ';

export function parseWindows(out: string) {
  const m = new Map<number, { path: string; title: string }>();
  for (const line of out.split(/\r?\n/)) {
    const f = line.match(/^(\d+)\|([^|]*)\|(.*)$/);
    if (f) m.set(Number(f[1]), { path: f[2]!.trim(), title: f[3]!.trim() });
  }
  return m;
}

export function parseWmctrl(out: string, paths: Map<number, string>) {
  const m = new Map<number, { path: string; title: string }>();
  for (const line of out.split(/\r?\n/)) {
    const f = line.match(/^0x[0-9a-f]+\s+-?\d+\s+(\d+)\s+\S+\s+(.*)$/i);
    if (!f) continue;
    const pid = Number(f[1]);
    if (paths.has(pid) && !m.has(pid)) m.set(pid, { path: paths.get(pid)!, title: f[2]!.trim() });
  }
  return m;
}

async function windowTitles(pids: number[]) {
  const ids = pids.filter(p => Number.isInteger(p) && p > 0).slice(0, 32);
  if (!ids.length) return new Map<number, { path: string; title: string }>();
  if (process.platform !== 'win32') {
    const paths = new Map<number, string>();
    for (const id of ids) { try { paths.set(id, readlinkSync(`/proc/${id}/exe`)); } catch { } }
    return parseWmctrl(await run('wmctrl', ['-lp']).catch(() => ''), paths);
  }
  return parseWindows(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${PS_UTF8}Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)|$($_.MainWindowTitle)" }`]));
}

const run = (cmd: string, args: string[], timeout = 8000) => new Promise<string>((ok, fail) => {
  execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? fail(err) : ok(out)));
});

export function parseTasklist(csv: string) {
  const m = new Map<string, number[]>();
  for (const line of csv.split(/\r?\n/)) {
    const f = line.match(/^"([^"]*)","(\d+)"/);
    if (!f) continue;
    const k = f[1]!.toLowerCase();
    m.set(k, [...(m.get(k) ?? []), Number(f[2])]);
  }
  return m;
}

function namesOf(table: Proc[]) {
  const m = new Map<string, number[]>();
  for (const p of table) {
    const k = basename(p.path || p.name || '').toLowerCase();
    if (k) m.set(k, [...(m.get(k) ?? []), p.pid]);
  }
  return m;
}

function pathsOf(table: Proc[], pids: number[]) {
  const m = new Map<number, string>();
  for (const p of table) if (pids.includes(p.pid) && p.path) m.set(p.pid, normalize(p.path).toLowerCase());
  return m;
}

async function listProcesses() {
  return parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh']));
}

async function processPaths(pids: number[]) {
  const m = new Map<number, string>();
  const ids = pids.filter(p => Number.isInteger(p) && p > 0).slice(0, 32);
  if (!ids.length) return m;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${PS_UTF8}Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`]);
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf('|'); if (i < 0) continue;
    const path = line.slice(i + 1).trim();
    if (path) m.set(Number(line.slice(0, i)), normalize(path).toLowerCase());
  }
  return m;
}
