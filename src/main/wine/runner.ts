import { spawn } from 'node:child_process';
import { accessSync, appendFileSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { RunnerBuild, WineConfig } from '@shared/wine';
import { dataDir, prefixDir, steamLibraries, steamRoots } from '../steam';

export interface Deps { home: string; env: NodeJS.ProcessEnv; system?: boolean }
export const realDeps = (): Deps => ({ home: homedir(), env: process.env });

export type StoreKind = 'runners' | 'dxvk' | 'vkd3d' | 'umu' | 'winetricks';
export const storeDir = (kind: StoreKind, d: Deps = realDeps()) => join(dataDir(d.home, d.env), 'wine', kind);

const isExec = (p: string) => { try { return statSync(p).isFile() && (accessSync(p, constants.X_OK), true); } catch { return false; } };

export function findExecutable(name: string, d: Deps = realDeps()): string | null {
  const system = d.system === false ? [] : [...(d.env.PATH ?? '').split(delimiter), '/usr/local/bin', '/usr/bin', '/bin', '/opt/bin'];
  const dirs = [...system, join(d.home, '.local', 'bin'), join(d.home, 'bin')].filter(Boolean);
  if (name === 'umu-run') dirs.push(join(storeDir('umu', d), 'umu'));
  if (name === 'winetricks') dirs.push(storeDir('winetricks', d));
  const dir = dirs.find(x => isExec(join(x, name)));
  return dir ? join(dir, name) : null;
}

export const detectTools = (d: Deps = realDeps()) => ({ umu: findExecutable('umu-run', d), wine: findExecutable('wine', d), winetricks: findExecutable('winetricks', d) });

const FAMILY_RANK: Record<RunnerBuild['family'], number> = { ge: 3, cachyos: 2, valve: 1, other: 0, wine: 0 };

function familyOf(name: string): RunnerBuild['family'] {
  if (/^GE-Proton|proton-ge/i.test(name)) return 'ge';
  if (/cachyos/i.test(name)) return 'cachyos';
  if (/^Proton\b/i.test(name)) return 'valve';
  return 'other';
}

function buildVersion(name: string) {
  if (/experimental/i.test(name)) return 1e6;
  const m = name.match(/(\d+)[.-](\d+)/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : -1;
}

const rank = (a: RunnerBuild, b: RunnerBuild) =>
  FAMILY_RANK[b.family] - FAMILY_RANK[a.family] || buildVersion(b.name) - buildVersion(a.name) || b.name.localeCompare(a.name, 'en', { numeric: true });

const ls = (p: string) => { try { return readdirSync(p); } catch { return []; } };

export function discoverBuilds(d: Deps = realDeps()): RunnerBuild[] {
  const found = new Map<string, RunnerBuild>();
  const add = (dir: string, where: RunnerBuild['where']) => {
    let id: string; try { id = realpathSync(dir); } catch { return; }
    if (found.has(id)) return;
    const name = id.split('/').pop()!;
    if (existsSync(join(id, 'proton'))) found.set(id, { id, name, kind: 'proton', family: familyOf(name), where });
    else if (existsSync(join(id, 'bin', 'wine'))) found.set(id, { id, name, kind: 'wine', family: 'wine', where });
  };
  const scan = (parent: string, where: RunnerBuild['where']) => { for (const n of ls(parent)) if (!n.endsWith('.tmp')) add(join(parent, n), where); };

  for (const root of steamRoots(d.home)) {
    scan(join(root, 'compatibilitytools.d'), 'steam');
    for (const lib of steamLibraries(root)) for (const n of ls(join(lib, 'common'))) if (/^proton/i.test(n)) add(join(lib, 'common', n), 'steam');
  }
  if (d.system !== false) for (const p of ['/usr/share/steam/compatibilitytools.d', '/usr/local/share/steam/compatibilitytools.d']) scan(p, 'system');
  scan(storeDir('runners', d), 'cartucho');

  const out = [...found.values()].sort(rank);
  if (findExecutable('wine', d)) out.push({ id: 'system', name: 'wine (system)', kind: 'wine', family: 'wine', where: 'system' });
  return out;
}

const pickBuild = (builds: RunnerBuild[], kind: RunnerBuild['kind'], id: string | null) =>
  (id ? builds.find(b => b.id === id && b.kind === kind) : builds.filter(b => b.kind === kind).sort(rank)[0]) ?? null;

export type RunnerName = 'umu' | 'proton' | 'wine';
export type RunnerError = RunnerName | 'none' | 'build-missing';

export interface Runner {
  name: RunnerName;
  cmd: string;
  env: Record<string, string>;
  how: string;
  prefix: string;
  compat: string | null;
  build: RunnerBuild | null;
  firstRun: boolean;
  wineBin: string | null;
}

export interface RunnerResult { runner: Runner | null; error?: RunnerError }

function syncEnv(mode: WineConfig['sync']): Record<string, string> {
  if (mode === 'esync') return { WINEESYNC: '1', PROTON_NO_FSYNC: '1' };
  if (mode === 'fsync') return { WINEFSYNC: '1' };
  if (mode === 'none') return { WINEESYNC: '0', WINEFSYNC: '0', PROTON_NO_ESYNC: '1', PROTON_NO_FSYNC: '1', PROTON_NO_NTSYNC: '1' };
  return {};
}

const protonWine = (dir: string) => [join(dir, 'files', 'bin', 'wine'), join(dir, 'dist', 'bin', 'wine')].find(existsSync) ?? null;

type Pick = Omit<Runner, 'prefix' | 'firstRun'>;

export function resolveRunner(gameId: string, cfg: WineConfig, d: Deps = realDeps(), builds = discoverBuilds(d)): RunnerResult {
  const want = cfg.runnerBuild ? builds.find(b => b.id === cfg.runnerBuild) ?? null : null;
  if (cfg.runnerBuild && !want) return { runner: null, error: 'build-missing' };
  const proton = pickBuild(builds, 'proton', want?.kind === 'proton' ? want.id : null);
  const wine = want?.kind === 'wine' ? want : pickBuild(builds, 'wine', null);
  const umu = findExecutable('umu-run', d);
  const compat = prefixDir(gameId, d.home), prefix = cfg.prefixPath ?? join(compat, 'pfx');

  const attempt = (name: RunnerName): Pick | null => {
    if (name === 'umu' && umu && want?.kind !== 'wine') {
      return { name, cmd: umu, env: { WINEPREFIX: prefix, GAMEID: 'umu-default', STORE: 'none', PROTONPATH: proton?.id ?? 'GE-Proton' }, how: `umu (${proton?.name ?? 'GE-Proton, download'})`, compat: null, build: proton, wineBin: null };
    }
    if (name === 'proton' && proton) {
      return { name, cmd: join(proton.id, 'proton'), env: { STEAM_COMPAT_DATA_PATH: compat, STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoots(d.home)[0] ?? compat }, how: `proton (${proton.name})`, compat, build: proton, wineBin: protonWine(proton.id) };
    }
    if (name === 'wine' && wine) {
      const bin = wine.id === 'system' ? findExecutable('wine', d)! : join(wine.id, 'bin', 'wine');
      const env: Record<string, string> = { WINEPREFIX: prefix, WINEDEBUG: '-all' };
      if (wine.id !== 'system') env.PATH = `${join(wine.id, 'bin')}${delimiter}${d.env.PATH ?? ''}`;
      return { name, cmd: bin, env, how: `wine (${wine.name})`, compat: null, build: wine, wineBin: bin };
    }
    return null;
  };

  const order: RunnerName[] = cfg.runner !== 'auto' ? [cfg.runner] : want?.kind === 'wine' ? ['wine'] : ['umu', 'proton', 'wine'];
  for (const name of order) {
    const p = attempt(name);
    if (p) return { runner: { ...p, prefix, firstRun: !existsSync(join(prefix, 'system.reg')), env: { ...p.env, ...syncEnv(cfg.sync), ...cfg.env } } };
  }
  return { runner: null, error: cfg.runner === 'auto' ? 'none' : cfg.runner };
}

export function launchArgs(r: Runner, file: string): string[] {
  if (r.name === 'proton') return ['run', file];
  if (r.name === 'wine' && !/\.exe$/i.test(file)) return ['start', '/unix', file];
  return [file];
}

export const toolArgs = (r: Runner, argv: string[]) => (r.name === 'proton' ? ['waitforexitandrun', ...argv] : argv);

export function ensureDirs(r: Runner) {
  mkdirSync(r.prefix, { recursive: true });
  if (!r.compat) return;
  mkdirSync(r.compat, { recursive: true });
  const link = join(r.compat, 'pfx');
  if (link === r.prefix) return;
  let st; try { st = lstatSync(link); } catch { st = null; }
  if (st?.isSymbolicLink()) return;
  if (st?.isDirectory()) { try { rmdirSync(link); } catch { return; } }
  try { symlinkSync(r.prefix, link); } catch { }
}

export interface ToolResult { code: number | null; output: string }
export interface SpawnOpts { cwd?: string; log?: string; timeout?: number; env?: Record<string, string> }

export function spawnLogged(cmd: string, args: string[], opts: SpawnOpts = {}) {
  const { promise, resolve } = Promise.withResolvers<ToolResult>();
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const take = (b: Buffer) => { const s = b.toString(); out = (out + s).slice(-20_000); if (opts.log) try { appendFileSync(opts.log, s); } catch { } };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeout ?? 300_000);
  child.once('error', e => { clearTimeout(timer); resolve({ code: null, output: out + String(e.message) }); });
  child.once('close', code => { clearTimeout(timer); resolve({ code, output: out }); });
  return promise;
}

export const runTool = (r: Runner, argv: string[], opts: SpawnOpts = {}) => spawnLogged(r.cmd, toolArgs(r, argv), { ...opts, env: { ...r.env, ...opts.env } });
