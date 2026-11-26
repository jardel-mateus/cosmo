import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, closeSync, copyFileSync, cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { InstallProgress } from '@shared/types';
import type { Download, RemoteBuild, VulkanInfo, WineVersions } from '@shared/wine';
import { tt } from '@shared/i18n';
import { extract } from '../ports/files';
import { githubToken } from '../ports/github';
import { dataDir } from '../steam';
import { discoverBuilds, findExecutable, storeDir } from './runner';

export const wineEvents = new EventEmitter<{ progress: [InstallProgress] }>();
type Send = (stage: string, pct: number) => void;
export const sender = (key: string): Send => (stage, pct) => wineEvents.emit('progress', { key, stage, pct });
export const finish = (key: string, error?: string) =>
  wineEvents.emit('progress', { key, stage: error ? tt('Erro') : tt('Pronto'), pct: error ? 0 : 1, done: true, ...(error ? { error } : {}) });

interface Rel { tag: string; assets: { name: string; url: string; digest: string | null; size?: number | null }[] }

async function getJson<T>(url: string): Promise<T> {
  const token = url.startsWith('https://api.github.com/') ? githubToken() : null;
  const res = await fetch(url, { headers: { 'User-Agent': 'Cosmo', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(tt('Não consegui consultar {0} (erro {1}).', { 0: new URL(url).host, 1: res.status }));
  return res.json() as Promise<T>;
}

async function ghReleases(repo: string, n = 30): Promise<Rel[]> {
  const list = await getJson<{ tag_name: string; draft?: boolean; assets: { name: string; browser_download_url: string; digest?: string | null; size?: number }[] }[]>(`https://api.github.com/repos/${repo}/releases?per_page=${n}`);
  return list.filter(r => !r.draft).map(r => ({ tag: r.tag_name, assets: r.assets.map(a => ({ name: a.name, url: a.browser_download_url, digest: a.digest ?? null, size: a.size ?? null })) }));
}

async function gplasyncReleases(): Promise<Rel[]> {
  const list = await getJson<{ tag_name: string; assets: { links: { name: string; direct_asset_url?: string; url: string }[] } }[]>('https://gitlab.com/api/v4/projects/Ph42oN%2Fdxvk-gplasync/releases?per_page=30');
  return list.map(r => ({ tag: r.tag_name, assets: r.assets.links.map(l => ({ name: l.name, url: l.direct_asset_url ?? l.url, digest: null })) }));
}

const cacheFile = () => join(dataDir(), 'wine', 'releases.json');
const memo = new Map<string, { at: number; rels: Rel[] }>();

async function cached(key: string, load: () => Promise<Rel[]>): Promise<Rel[]> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.rels;
  const disk = (): Record<string, Rel[]> => { try { return JSON.parse(readFileSync(cacheFile(), 'utf8')) as Record<string, Rel[]>; } catch { return {}; } };
  try {
    const rels = await load();
    memo.set(key, { at: Date.now(), rels });
    try { mkdirSync(dirname(cacheFile()), { recursive: true }); writeFileSync(cacheFile(), JSON.stringify({ ...disk(), [key]: rels })); } catch { }
    return rels;
  } catch (e) {
    const old = disk()[key];
    if (old) return old;
    throw e;
  }
}

const dxvkReleases = () => cached('dxvk', () => ghReleases('doitsujin/dxvk'));
const gplasyncCached = () => cached('gplasync', gplasyncReleases);
const vkd3dReleases = () => cached('vkd3d', () => ghReleases('HansKristian-Work/vkd3d-proton', 15));

export const cmpVer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
};
export const newestFirst = (a: string, b: string) => cmpVer(b, a);

export const DXVK_NEEDS_VK14_FROM = '3.0';

const dxvkAsset = (r: Rel) => r.assets.find(a => /^dxvk-\d[\d.]*\.tar\.gz$/.test(a.name));
const gplasyncAsset = (r: Rel) => r.assets.find(a => a.name.endsWith('.tar.gz'));
const gplasyncTag = (tag: string) => tag.match(/^v(\d+(?:\.\d+)*)-(\d+)$/);

export function pickDxvk(versions: string[], supports14: boolean | null, want: string): string | null {
  if (want !== 'auto') return versions.includes(want) ? want : null;
  const pool = supports14 === false ? versions.filter(v => cmpVer(v, DXVK_NEEDS_VK14_FROM) < 0) : versions;
  return pool[0] ?? null;
}

let vulkanCache: Promise<VulkanInfo> | null = null;
export function vulkan(): Promise<VulkanInfo> {
  return (vulkanCache ??= new Promise(done => {
    execFile('vulkaninfo', ['--summary'], { encoding: 'utf8', timeout: 10_000 }, (err, stdout) => {
      let best: string | null = null;
      for (const block of (err ? '' : stdout).split(/^GPU\d+:/m).slice(1)) {
        if (/PHYSICAL_DEVICE_TYPE_CPU/.test(block)) continue;
        const v = block.match(/apiVersion\s*=\s*(\d+\.\d+(?:\.\d+)?)/)?.[1];
        if (v && (!best || cmpVer(v, best) > 0)) best = v;
      }
      done({ apiVersion: best, supports14: best ? cmpVer(best, '1.4') >= 0 : null });
    });
  }));
}


function downloadedDxvk(async: boolean) {
  const prefix = async ? 'dxvk-gplasync-' : 'dxvk-';
  let names: string[] = []; try { names = readdirSync(storeDir('dxvk')); } catch { }
  return names.filter(n => n.startsWith(prefix) && (async || !n.startsWith('dxvk-gplasync-'))).map(n => n.slice(prefix.length).replace(/-\d+$/, '')).filter(v => /^\d+(\.\d+)*$/.test(v)).sort(newestFirst);
}

export async function listVersions(): Promise<WineVersions> {
  const [d, a, k] = await Promise.allSettled([dxvkReleases(), gplasyncCached(), vkd3dReleases()]);
  const dxvk = d.status === 'fulfilled' ? d.value.filter(dxvkAsset).map(r => r.tag.replace(/^v/, '')).sort(newestFirst) : downloadedDxvk(false);
  const dxvkAsync = a.status === 'fulfilled' ? [...new Set(a.value.map(r => gplasyncTag(r.tag)?.[1]).filter((v): v is string => !!v))].sort(newestFirst) : downloadedDxvk(true);
  const vkd3d = k.status === 'fulfilled' ? k.value.map(r => r.tag.replace(/^v/, '')) : [];
  return { dxvk, dxvkAsync, vkd3d, dxvkDefault: pickDxvk(dxvk, (await vulkan()).supports14, 'auto') };
}

async function download(url: string, dest: string, send: Send, stage: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Cosmo' }, redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(tt('O download falhou (erro {0}): {1}', { 0: res.status, 1: new URL(url).host }));
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const body = Readable.fromWeb(res.body as WebStream<Uint8Array>);
  body.on('data', (c: Buffer) => { got += c.length; if (total) send(stage, Math.min(0.95, got / total)); });
  await pipeline(body, createWriteStream(dest));
}

async function checksum(file: string, algo: 'sha256' | 'sha512') {
  const h = createHash(algo);
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

async function verify(file: string, asset: Rel['assets'][number], all: Rel['assets']) {
  const bad = () => new Error(tt('O download de {0} não bate com o hash publicado. Nada foi instalado.', { 0: asset.name }));
  const digest = asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1];
  if (digest) { if ((await checksum(file, 'sha256')) !== digest.toLowerCase()) throw bad(); return; }
  const own = all.find(a => a.name === `${asset.name.replace(/\.tar\.\w+$/, '')}.sha512sum`);
  const src = own ?? all.find(a => /^sha256sums?\.txt$/i.test(a.name));
  if (!src) return;
  const text = await (await fetch(src.url, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(30_000) })).text();
  const hash = (text.split(/\r?\n/).find(l => l.includes(asset.name)) ?? (own ? text : ''))?.match(/\b([0-9a-f]{64}|[0-9a-f]{128})\b/i)?.[1]?.toLowerCase();
  if (hash && (await checksum(file, hash.length === 128 ? 'sha512' : 'sha256')) !== hash) throw bad();
}

const topDir = (dir: string) => {
  const list = readdirSync(dir, { withFileTypes: true });
  return list.length === 1 && list[0]!.isDirectory() ? join(dir, list[0]!.name) : dir;
};

async function fetchPack(key: string, asset: Rel['assets'][number], all: Rel['assets'], place: (dir: string) => string) {
  const work = join(dataDir(), 'wine', 'tmp'), send = sender(key), stage = tt('Baixando {0}…', { 0: asset.name });
  if (/\.zst$/i.test(asset.name) && !findExecutable('zstd') && !findExecutable('bsdtar')) {
    const err = tt('Para abrir {0} o sistema precisa do zstd (no Ubuntu e no Mint: sudo apt install zstd).', { 0: asset.name });
    finish(key, err);
    throw new Error(err);
  }
  mkdirSync(work, { recursive: true });
  const tmp = mkdtempSync(join(work, 'dl-'));
  try {
    const file = join(tmp, asset.name), out = join(tmp, 'x');
    send(stage, 0);
    await download(asset.url, file, send, stage);
    send(tt('Conferindo…'), 0.96);
    await verify(file, asset, all);
    send(tt('Desempacotando…'), 0.97);
    mkdirSync(out);
    await extract(file, out);
    const dest = place(topDir(out));
    finish(key);
    return dest;
  } catch (e) { finish(key, (e as Error).message); throw e; }
  finally { rmSync(tmp, { recursive: true, force: true }); }
}

function moveInto(store: string, name: string, from: string) {
  mkdirSync(store, { recursive: true });
  const dest = join(store, name);
  rmSync(dest, { recursive: true, force: true });
  try { renameSync(from, dest); } catch {
    const tmp = `${dest}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    cpSync(from, tmp, { recursive: true, verbatimSymlinks: true });
    renameSync(tmp, dest);
  }
  return dest;
}

export interface Pack { dir: string; name: string }

async function findDxvk(version: string, async: boolean) {
  let name: string, rel: Rel | undefined, asset: Rel['assets'][number] | undefined;
  if (async) {
    rel = (await gplasyncCached()).filter(r => gplasyncTag(r.tag)?.[1] === version).sort((a, b) => Number(gplasyncTag(b.tag)![2]) - Number(gplasyncTag(a.tag)![2]))[0];
    asset = rel && gplasyncAsset(rel);
    name = `dxvk-gplasync-${rel?.tag.replace(/^v/, '')}`;
  } else {
    rel = (await dxvkReleases()).find(r => r.tag.replace(/^v/, '') === version);
    asset = rel && dxvkAsset(rel);
    name = `dxvk-${version}`;
  }
  const store = storeDir('dxvk'), dir = join(store, name);
  return { store, name, dir, rel, asset, have: existsSync(join(dir, 'x64')) };
}

async function findVkd3d(version: string) {
  const store = storeDir('vkd3d'), name = `vkd3d-proton-${version}`, dir = join(store, name);
  const have = existsSync(join(dir, 'x64'));
  const rel = have ? undefined : (await vkd3dReleases()).find(r => r.tag.replace(/^v/, '') === version);
  return { store, name, dir, rel, asset: rel?.assets.find(a => /\.tar\.(zst|gz|xz)$/.test(a.name)), have };
}

export async function dxvkMissing(version: string, async: boolean): Promise<Download | null> {
  const f = await findDxvk(version, async);
  return f.have ? null : { name: `DXVK ${async ? 'async ' : ''}${version}`, size: f.asset?.size ?? null };
}

export async function vkd3dMissing(version: string): Promise<Download | null> {
  const f = await findVkd3d(version);
  return f.have ? null : { name: `VKD3D-Proton ${version}`, size: f.asset?.size ?? null };
}

export async function ensureDxvk(version: string, async: boolean): Promise<Pack> {
  const { store, name, dir, rel, asset, have } = await findDxvk(version, async);
  if (have) return { dir, name };
  if (!rel || !asset) throw new Error(tt('Não existe DXVK {0}{1}.', { 0: version, 1: async ? ' async' : '' }));
  return { dir: await fetchPack(`wine:${name}`, asset, rel.assets, from => moveInto(store, name, from)), name };
}

export async function ensureVkd3d(version: string): Promise<Pack> {
  const { store, name, dir, rel, asset, have } = await findVkd3d(version);
  if (have) return { dir, name };
  if (!rel || !asset) throw new Error(tt('Não existe VKD3D-Proton {0}.', { 0: version }));
  return { dir: await fetchPack(`wine:${name}`, asset, rel.assets, from => moveInto(store, name, from)), name };
}

export const DXVK_DLLS = ['d3d8', 'd3d9', 'd3d10core', 'd3d11', 'dxgi'];
export const VKD3D_DLLS = ['d3d12', 'd3d12core'];
export const overrides = (dlls: string[]) => `${dlls.join(',')}=n,b`;

interface Marker { pack: string; files: { path: string; backup: string | null }[] }
const readMarker = (p: string): Marker | null => { try { return JSON.parse(readFileSync(p, 'utf8')) as Marker; } catch { return null; } };

export function undeploy(marker: string) {
  const m = readMarker(marker); if (!m) return;
  for (const f of m.files) {
    try { rmSync(f.path, { force: true }); if (f.backup && existsSync(f.backup)) renameSync(f.backup, f.path); } catch { }
  }
  rmSync(marker, { force: true });
}

export function deploy(pack: Pack, dlls: string[], targets: { x64: string | null; x32: string | null }, marker: string) {
  const old = readMarker(marker);
  if (old?.pack === pack.name && old.files.every(f => existsSync(f.path))) return;
  undeploy(marker);
  const files: Marker['files'] = [];
  const save = (done: boolean) => writeFileSync(marker, JSON.stringify({ pack: done ? pack.name : '', files } satisfies Marker));
  for (const [arch, folder] of [['x64', targets.x64], ['x32', targets.x32]] as const) {
    const src = [join(pack.dir, arch), join(pack.dir, arch === 'x32' ? 'x86' : arch)].find(existsSync);
    if (!folder || !src) continue;
    mkdirSync(folder, { recursive: true });
    for (const n of dlls) {
      const from = join(src, `${n}.dll`), to = join(folder, `${n}.dll`), bak = `${to}.cartucho-bak`;
      if (!existsSync(from)) continue;
      const backup = existsSync(bak) ? bak : existsSync(to) ? (renameSync(to, bak), bak) : null;
      files.push({ path: to, backup });
      save(false);
      copyFileSync(from, to);
    }
  }
  save(true);
}

export function peBits(exe: string): 32 | 64 {
  let fd = -1;
  try {
    fd = openSync(exe, 'r');
    const head = Buffer.alloc(4096), n = readSync(fd, head, 0, 4096, 0);
    const at = n >= 0x40 ? head.readUInt32LE(0x3c) : n;
    if (at + 6 > n || head.toString('latin1', at, at + 4) !== 'PE\0\0') return 64;
    return head.readUInt16LE(at + 4) === 0x14c ? 32 : 64;
  } catch { return 64; } finally { if (fd >= 0) closeSync(fd); }
}

interface Remote extends RemoteBuild { rel: Rel; asset: Rel['assets'][number] }

async function remoteList(): Promise<Remote[]> {
  const out: Remote[] = [];
  const have = discoverBuilds().map(b => b.name.toLowerCase());
  const add = (family: Remote['family'], rel: Rel, asset: Rel['assets'][number], name: string) =>
    out.push({ id: `${family}|${rel.tag}|${asset.name}`, name, family, size: asset.size ?? null, installed: have.some(h => h === name.toLowerCase() || h.startsWith(`${name.toLowerCase()}-`)), rel, asset });
  const [ge, cachy, kron] = await Promise.allSettled([
    cached('ge', () => ghReleases('GloriousEggroll/proton-ge-custom', 15)),
    cached('cachyos', () => ghReleases('CachyOS/proton-cachyos', 10)),
    cached('kron4ek', () => ghReleases('Kron4ek/Wine-Builds', 10)),
  ]);
  if (ge.status === 'fulfilled') for (const r of ge.value) { const a = r.assets.find(x => /^GE-Proton[\d-]+(-x86_64)?\.tar\.gz$/.test(x.name)); if (a) add('ge', r, a, r.tag); }
  if (cachy.status === 'fulfilled') for (const r of cachy.value) { const a = r.assets.find(x => /^proton-cachyos-.*-x86_64\.tar\.xz$/.test(x.name)); if (a) add('cachyos', r, a, a.name.replace(/\.tar\.xz$/, '')); }
  if (kron.status === 'fulfilled') for (const r of kron.value) for (const a of r.assets.filter(x => /^wine-[\d.]+(-staging)?-amd64-wow64\.tar\.xz$/.test(x.name))) add('wine', r, a, a.name.replace(/\.tar\.xz$/, ''));
  if (!out.length && ge.status === 'rejected') throw ge.reason as Error;
  return out;
}

export async function remoteBuilds(): Promise<RemoteBuild[]> { return (await remoteList()).map(({ id, name, family, size, installed }) => ({ id, name, family, size, installed })); }

export async function installBuild(id: string) {
  const r = (await remoteList()).find(x => x.id === id);
  if (!r) throw new Error(tt('Essa versão não está mais na lista.'));
  return fetchPack(`wine:${r.name}`, r.asset, r.rel.assets, from => {
    if (!existsSync(join(from, 'proton')) && !existsSync(join(from, 'bin', 'wine'))) throw new Error(tt('{0} não parece um Proton nem um Wine.', { 0: r.asset.name }));
    return moveInto(storeDir('runners'), basename(from) === 'x' ? r.name : basename(from), from);
  });
}

export async function latestGE(): Promise<Download | null> {
  const ge = (await remoteList()).find(x => x.family === 'ge');
  return ge ? { name: ge.name, size: ge.size } : null;
}

export async function installLatestGE() {
  const ge = (await remoteList()).find(x => x.family === 'ge');
  if (!ge) throw new Error(tt('Não achei nenhum Proton-GE para baixar.'));
  return installBuild(ge.id);
}

export function removeBuild(dir: string) {
  if (!resolve(dir).startsWith(storeDir('runners') + sep)) throw new Error(tt('O Cosmo só apaga o que ele mesmo baixou.'));
  rmSync(dir, { recursive: true, force: true });
}

export async function installUmu() {
  const rel = (await cached('umu', () => ghReleases('Open-Wine-Components/umu-launcher', 5))).find(r => r.assets.some(a => a.name.endsWith('zipapp.tar')));
  const asset = rel?.assets.find(a => a.name.endsWith('zipapp.tar'));
  if (!rel || !asset) throw new Error(tt('Não achei o umu-launcher para baixar.'));
  return fetchPack('wine:umu', asset, rel.assets, from => {
    if (!existsSync(join(from, 'umu-run'))) throw new Error(tt('{0} não tem o umu-run.', { 0: asset.name }));
    const dest = moveInto(storeDir('umu'), 'umu', from);
    chmodSync(join(dest, 'umu-run'), 0o755);
    return join(dest, 'umu-run');
  });
}

export async function installWinetricks() {
  const key = 'wine:winetricks';
  try {
    sender(key)(tt('Baixando o winetricks…'), 0.1);
    const { tag_name: tag } = await getJson<{ tag_name: string }>('https://api.github.com/repos/Winetricks/winetricks/releases/latest');
    const res = await fetch(`https://raw.githubusercontent.com/Winetricks/winetricks/${tag}/src/winetricks`, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(tt('O download falhou (erro {0}): {1}', { 0: res.status, 1: 'raw.githubusercontent.com' }));
    const text = await res.text();
    if (!text.startsWith('#!')) throw new Error(tt('O winetricks baixado não parece um script.'));
    const file = join(storeDir('winetricks'), 'winetricks');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode: 0o755 });
    finish(key);
    return file;
  } catch (e) { finish(key, (e as Error).message); throw e; }
}
