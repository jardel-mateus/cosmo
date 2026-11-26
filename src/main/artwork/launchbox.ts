import { createReadStream, createWriteStream, statSync, type WriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import type { Readable } from 'node:stream';
import { tt } from '@shared/i18n';

export const PLATFORMS: Record<string, string> = {
  snes: 'Super Nintendo Entertainment System', n64: 'Nintendo 64', gc: 'Nintendo GameCube', wii: 'Nintendo Wii',
  switch: 'Nintendo Switch', switch2: 'Nintendo Switch 2', ps1: 'Sony Playstation', ps2: 'Sony Playstation 2', ps3: 'Sony Playstation 3',
  ps4: 'Sony Playstation 4', ps5: 'Sony Playstation 5', psp: 'Sony PSP', x360: 'Microsoft Xbox 360', pc: 'Windows',
  nes: 'Nintendo Entertainment System', xbox: 'Microsoft Xbox', wiiu: 'Nintendo Wii U', nds: 'Nintendo DS', '3ds': 'Nintendo 3DS',
  gb: 'Nintendo Game Boy', gbc: 'Nintendo Game Boy Color', gba: 'Nintendo Game Boy Advance', megadrive: 'Sega Genesis',
  dreamcast: 'Sega Dreamcast', saturn: 'Sega Saturn', mastersystem: 'Sega Master System', vita: 'Sony Playstation Vita', arcade: 'Arcade',
};

export const KINDS = {
  cover: ['Box - Front', 'Box - Front - Reconstructed'],
  logo: ['Clear Logo'],
  fanart: ['Fanart - Background'],
  screenshot: ['Screenshot - Gameplay'],
} as const;
export type ArtKind = keyof typeof KINDS;

const INDEX_VERSION = 2;
const INFO_BUCKETS = 64;
const OVERVIEW_MAX = 2400;
const REFRESH_AFTER = 30 * 86400_000;
const IMAGES_KEPT = 4;

function regionScore(region: string) {
  if (!region) return 1;
  if (/North America|United States|Canada|World/.test(region)) return 0;
  if (/Europe|United Kingdom|Australia|Oceania/.test(region)) return 2;
  return 3;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, n: string) =>
  n[0] !== '#' ? ENTITIES[n.toLowerCase()] ?? whole : String.fromCodePoint(n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : Number(n.slice(1))));
function tagText(record: string, tag: string) {
  const start = record.indexOf(`<${tag}>`);
  if (start < 0) return '';
  const from = start + tag.length + 2, end = record.indexOf(`</${tag}>`, from);
  return end < 0 ? '' : unescapeXml(record.slice(from, end)).trim();
}

export async function openZipEntry(zipFile: string, wanted: string): Promise<Readable> {
  const file = await fsp.open(zipFile, 'r');
  try {
    const { size } = await file.stat();
    const tailLength = Math.min(size, 0xffff + 22);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    const end = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (end < 0) throw new Error(tt('O banco do LaunchBox baixado não é um zip.'));
    const dirSize = tail.readUInt32LE(end + 12), dirStart = tail.readUInt32LE(end + 16);
    const dir = Buffer.alloc(dirSize);
    await file.read(dir, 0, dirSize, dirStart);
    for (let at = 0; at + 46 <= dir.length && dir.readUInt32LE(at) === 0x02014b50;) {
      const nameLength = dir.readUInt16LE(at + 28), name = dir.toString('utf8', at + 46, at + 46 + nameLength);
      if (name === wanted) {
        const method = dir.readUInt16LE(at + 10), packed = dir.readUInt32LE(at + 20), localHeader = dir.readUInt32LE(at + 42);
        const local = Buffer.alloc(30);
        await file.read(local, 0, 30, localHeader);
        const dataStart = localHeader + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const raw = createReadStream(zipFile, { start: dataStart, end: dataStart + packed - 1 });
        if (method === 0) return raw;
        if (method === 8) return raw.pipe(createInflateRaw());
        throw new Error(tt('O banco do LaunchBox usa uma compressão que o Cosmo não lê.'));
      }
      at += 46 + nameLength + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    }
    throw new Error(tt('O banco do LaunchBox não tem {0}.', { 0: wanted }));
  } finally {
    await file.close();
  }
}

type Table<T> = Record<string, T>;
export interface LaunchBoxIndex { version: number; built: number; names: Table<Table<string[]>>; images: Table<Table<Partial<Record<ArtKind, string[]>>>> }

export interface LaunchBoxInfo { overview: string | null; developer: string | null; year: number | null }

export const infoBucket = (id: string) => `${(Number(id) || 0) % INFO_BUCKETS}.jsonl`;

export async function readDatabase(zipFile: string, key: (s: string) => string, infoDir?: string): Promise<LaunchBoxIndex> {
  const wanted = new Set(Object.values(PLATFORMS));
  const kindOf = new Map<string, { kind: ArtKind; rank: number }>();
  for (const [kind, types] of Object.entries(KINDS)) types.forEach((t, rank) => kindOf.set(t, { kind: kind as ArtKind, rank }));
  const table = <T>() => Object.create(null) as Table<T>;
  const names = table<Table<string[]>>(), raw = table<Table<Partial<Record<ArtKind, { f: string; s: number }[]>>>>();
  const platformOf = new Map<string, string>();
  const addName = (platform: string, name: string, id: string) => {
    const k = key(name); if (!k) return;
    const ids = ((names[platform] ??= table())[k] ??= []);
    if (!ids.includes(id)) ids.push(id);
  };

  const buckets = new Map<string, WriteStream>();
  const writeInfo = (id: string, rec: string) => {
    if (!infoDir) return;
    const overview = tagText(rec, 'Overview').replace(/\r\n?/g, '\n').slice(0, OVERVIEW_MAX), developer = tagText(rec, 'Developer');
    const year = Number((tagText(rec, 'ReleaseYear') || tagText(rec, 'ReleaseDate')).slice(0, 4)) || null;
    if (!overview && !developer && !year) return;
    const b = infoBucket(id);
    let w = buckets.get(b);
    if (!w) { w = createWriteStream(join(infoDir, b), { flags: 'a' }); buckets.set(b, w); }
    w.write(JSON.stringify([id, overview || null, developer || null, year]) + '\n');
  };

  const stream = await openZipEntry(zipFile, 'Metadata.xml');
  stream.setEncoding('utf8');
  const record = /<(Game|GameAlternateName|GameImage)>([\s\S]*?)<\/\1>/g;
  let pending = '';
  for await (const chunk of stream) {
    pending += chunk as string;
    record.lastIndex = 0;
    let used = 0;
    for (let m: RegExpExecArray | null; (m = record.exec(pending)); used = record.lastIndex) {
      const id = tagText(m[2]!, 'DatabaseID'); if (!id) continue;
      if (m[1] === 'Game') {
        const platform = tagText(m[2]!, 'Platform');
        if (!wanted.has(platform)) continue;
        platformOf.set(id, platform);
        addName(platform, tagText(m[2]!, 'Name'), id);
        writeInfo(id, m[2]!);
      } else if (m[1] === 'GameImage') {
        const platform = platformOf.get(id), type = kindOf.get(tagText(m[2]!, 'Type')), f = tagText(m[2]!, 'FileName');
        if (!platform || !type || !/^[\w.-]+\.(png|jpe?g)$/i.test(f)) continue;
        ((raw[platform] ??= table())[id] ??= {})[type.kind] ??= [];
        raw[platform]![id]![type.kind]!.push({ f, s: type.rank * 10 + regionScore(tagText(m[2]!, 'Region')) });
      } else if (platformOf.has(id)) addName(platformOf.get(id)!, tagText(m[2]!, 'AlternateName'), id);
    }
    pending = pending.slice(used);
    if (pending.length > 4e6) pending = pending.slice(-1e6);
  }
  await Promise.all([...buckets.values()].map(w => new Promise<void>((ok, fail) => w.end((e?: Error | null) => (e ? fail(e) : ok())))));
  if (!platformOf.size) throw new Error(tt('Nenhum jogo foi lido do banco do LaunchBox.'));
  const images = table<Table<Partial<Record<ArtKind, string[]>>>>();
  for (const [p, byGame] of Object.entries(raw))
    for (const [id, kinds] of Object.entries(byGame))
      for (const [k, list] of Object.entries(kinds))
        ((images[p] ??= table())[id] ??= {})[k as ArtKind] = list!.sort((a, b) => a.s - b.s).slice(0, IMAGES_KEPT).map(i => i.f);
  return { version: INDEX_VERSION, built: Date.now(), names, images };
}

export interface LaunchBoxOpts {
  folder: string;
  key: (s: string) => string;
  download: (url: string, file: string, onBytes: (got: number, total: number) => void) => Promise<void>;
  onStatus?: (msg: string | null) => void;
  metadataUrl?: string;
  imageUrl?: string;
}

export function createLaunchBox({ folder, key, download, onStatus = () => {}, metadataUrl = 'https://gamesdb.launchbox-app.com/Metadata.zip', imageUrl = 'https://images.launchbox-app.com' }: LaunchBoxOpts) {
  const indexFile = join(folder, 'launchbox-index.json'), infoDir = join(folder, 'launchbox-info');
  let current: Promise<LaunchBoxIndex> | null = null, building: Promise<LaunchBoxIndex> | null = null;

  const readIndex = async () => {
    const i = JSON.parse(await fsp.readFile(indexFile, 'utf8')) as LaunchBoxIndex;
    if (i?.version !== INDEX_VERSION) throw new Error(tt('índice de outra versão'));
    return i;
  };
  const age = () => { try { return Date.now() - statSync(indexFile).mtimeMs; } catch { return Infinity; } };

  async function rebuild() {
    await fsp.mkdir(folder, { recursive: true });
    const zip = join(folder, 'launchbox-metadata.zip');
    onStatus(tt('Baixando o banco de imagens do LaunchBox (uns 100 MB, uma vez por mês)…'));
    let last = 0;
    await download(metadataUrl, zip, (got, total) => {
      if (Date.now() - last < 500) return; last = Date.now();
      const mb = (n: number) => (n / 1048576).toFixed(0);
      onStatus(tt('Baixando o banco de imagens do LaunchBox: {0}{1} MB…', { 0: mb(got), 1: total ? ` de ${mb(total)}` : '' }));
    });
    onStatus(tt('Lendo o banco de imagens do LaunchBox…'));
    const infoTmp = infoDir + '.tmp';
    await fsp.rm(infoTmp, { recursive: true, force: true });
    await fsp.mkdir(infoTmp, { recursive: true });
    const index = await readDatabase(zip, key, infoTmp);
    await fsp.rm(infoDir, { recursive: true, force: true });
    await fsp.rename(infoTmp, infoDir);
    await fsp.writeFile(indexFile + '.tmp', JSON.stringify(index));
    await fsp.rename(indexFile + '.tmp', indexFile);
    await fsp.unlink(zip).catch(() => {});
    onStatus(null);
    return index;
  }

  function load({ offline = false, force = false } = {}): Promise<LaunchBoxIndex> {
    if (offline) return current ?? readIndex().then(i => (current ??= Promise.resolve(i)));
    const stale = force || age() >= REFRESH_AFTER;
    if (current && !stale) return current;
    if (building) return building;
    const job = (stale ? Promise.reject(new Error('velho')) : readIndex()).catch(() => rebuild());
    current = building = job;
    job.catch(e => { onStatus(tt('Não deu para baixar o banco de imagens do LaunchBox: {0}', { 0: (e as Error).message })); if (current === job) current = null; })
      .finally(() => { if (building === job) building = null; });
    return job;
  }

  const idsFor = (index: LaunchBoxIndex, platform: string, names: string[]) => {
    const byName = index.names[platform] ?? {};
    return [...new Set(names.map(key).filter(Boolean).flatMap(k => (Object.hasOwn(byName, k) ? byName[k]! : [])))];
  };

  async function info(platformKey: string, names: string[], opts: { offline?: boolean } = {}): Promise<LaunchBoxInfo | null> {
    const platform = PLATFORMS[platformKey]; if (!platform) return null;
    const ids = idsFor(await load(opts), platform, names);
    for (const id of ids) {
      let text = '';
      try { text = await fsp.readFile(join(infoDir, infoBucket(id)), 'utf8'); } catch { continue; }
      const prefix = `[${JSON.stringify(id)},`;
      for (const line of text.split('\n')) {
        if (!line.startsWith(prefix)) continue;
        const [, overview, developer, year] = JSON.parse(line) as [string, string | null, string | null, number | null];
        return { overview, developer, year };
      }
    }
    return null;
  }

  async function find(platformKey: string, names: string[], kind: ArtKind, opts: { offline?: boolean } = {}) {
    const platform = PLATFORMS[platformKey]; if (!platform) return [];
    const index = await load(opts);
    const byGame = index.images[platform] ?? {};
    const ids = idsFor(index, platform, names);
    for (const id of ids) { const files = Object.hasOwn(byGame, id) ? byGame[id]![kind] : null; if (files?.length) return files.map(f => `${imageUrl}/${encodeURIComponent(f)}`); }
    return [];
  }

  async function has(platformKey: string, names: string[]) {
    const platform = PLATFORMS[platformKey]; if (!platform) return false;
    return idsFor(await load({ offline: true }), platform, names).length > 0;
  }

  return { find, info, has, load, building: () => !!building };
}
export type LaunchBox = ReturnType<typeof createLaunchBox>;
