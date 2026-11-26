import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Fetch } from '../ports/github';
import { type ArtKind, KINDS, type LaunchBoxInfo, PLATFORMS, createLaunchBox } from './launchbox';
import { type Libretro, createLibretro } from './libretro';
import { tt } from '@shared/i18n';

export type ArtSet = Partial<Record<ArtKind, string>> & { /** A capa foi escolhida pelo jogador. */ custom?: boolean };

/** Imagem que dá para usar de capa, pelos primeiros bytes (não pela extensão). */
export function imageType(b: Buffer): 'png' | 'jpg' | 'webp' | 'gif' | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
const COVER_MAX = 25 * 1024 * 1024;

const FORMAT_TAG = /(\.(xiso|iso|cso|chd|rvz|wbfs|nsp|xci|z64|n64|v64|nds|3ds|gba|gbc|gb|sfc|smc|nes))+$/i;
export const cleanTitle = (n: string) => n.replace(FORMAT_TAG, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/^\d{3,5}\s*-?\s+(?=\S)/, '').replace(/\s+/g, ' ').trim() || n;
export const looseKey = (s: string) => cleanTitle(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&|\band\b|\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

const OTHER: [RegExp, string][] = [
  [/mega ?drive|genesis/i, 'megadrive'], [/dreamcast/i, 'dreamcast'], [/wii ?u/i, 'wiiu'], [/3ds/i, '3ds'], [/nintendo ds\b/i, 'nds'],
  [/game ?boy advance/i, 'gba'], [/game ?boy color/i, 'gbc'], [/game ?boy/i, 'gb'], [/\bnes\b|famicom/i, 'nes'], [/^xbox$/i, 'xbox'],
  [/saturn/i, 'saturn'], [/master system/i, 'mastersystem'], [/vita/i, 'vita'], [/arcade/i, 'arcade'],
];
const BY_NAME = new Set(['other', 'gb', 'megadrive']);
export const artPlatform = (console: string, platformName?: string | null) =>
  !BY_NAME.has(console) ? console : OTHER.find(([re]) => re.test(platformName ?? ''))?.[1] ?? (console !== 'other' ? console : platformName?.trim() ? null : 'pc');

const MAX_IMAGE = 20 * 1048576;
const NONE_VERSION = '2';
type SteamArt = Record<ArtKind, string[]>;
const NOT_FOUND_RETRY = 14 * 86400_000;
const isImage = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || b.subarray(8, 12).toString('latin1') === 'WEBP';
const extOf = (b: Buffer) => (b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : 'webp');

export class Artwork {
  readonly events = new EventEmitter<{ changed: []; status: [string | null] }>();
  status: string | null = null;
  private lb;
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private pending = new Set<string>();

  private steamCache = new Map<string, Promise<SteamArt | null>>();
  private steam: { store: string; api: string; cdn: string };

  /** Fontes extras de capa (libretro-thumbnails e Steam para qualquer plataforma). Desligadas nos testes. */
  private libretro: Libretro | null = null;
  private steamEverywhere = false;

  constructor(private dir: string, private fetch: Fetch, opts: { metadataUrl?: string; imageUrl?: string; steamStore?: string; steamApi?: string; steamCdn?: string; extraSources?: boolean; githubToken?: () => string | null } = {}) {
    const { steamStore, steamApi, steamCdn, extraSources, githubToken, ...lbOpts } = opts;
    this.steam = { store: steamStore ?? 'https://store.steampowered.com', api: steamApi ?? 'https://api.steampowered.com', cdn: steamCdn ?? 'https://shared.akamai.steamstatic.com/store_item_assets/' };
    if (extraSources) {
      this.libretro = createLibretro({ folder: join(dir, '_index', 'libretro'), fetch, key: looseKey, ...(githubToken ? { token: githubToken } : {}) });
      this.steamEverywhere = true;
    }
    this.lb = createLaunchBox({
      folder: join(dir, '_index'), key: looseKey, ...lbOpts,
      download: (url, file, onBytes) => this.download(url, file, onBytes),
      onStatus: s => { this.status = s; this.events.emit('status', s); },
    });
  }

  private async download(url: string, file: string, onBytes: (g: number, t: number) => void) {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(20 * 60_000) });
    if (!r.ok || !r.body) throw new Error(tt('erro {0}', { 0: r.status }));
    const total = Number(r.headers.get('content-length')) || 0;
    if (total > 600 * 1048576) throw new Error(tt('arquivo grande demais'));
    let got = 0;
    const part = file + '.part';
    try {
      await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), async function* (src) { for await (const c of src) { got += (c as Buffer).length; onBytes(got, total); yield c; } }, createWriteStream(part));
      await fsp.rename(part, file);
    } catch (e) { await fsp.unlink(part).catch(() => {}); throw e; }
  }

  async info(console: string, platformName: string | null | undefined, names: string[], offline = false): Promise<LaunchBoxInfo | null> {
    const platform = artPlatform(console, platformName);
    if (!platform || !PLATFORMS[platform]) return null;
    return this.lb.info(platform, names, { offline }).catch(() => null);
  }

  knows(console: string, names: string[]) {
    if (!PLATFORMS[console] || this.lb.building()) return Promise.resolve(false);
    return this.lb.has(console, names).catch(() => false);
  }

  indexReady() { return this.lb.building() ? Promise.resolve(false) : this.lb.load({ offline: true }).then(() => true, () => false); }

  notify() { this.changed(); }

  private folder(platform: string, kind: ArtKind) { return join(this.dir, platform, kind); }

  // Capa escolhida pelo jogador: _custom/<console>/<jogo>.<ext>, por console e título (vale também com o jogo desinstalado).
  private customDir(console: string) { return /^[a-z0-9_-]+$/i.test(console) ? join(this.dir, '_custom', console) : null; }
  private customKey(title: string) { return looseKey(title) || title.replace(/[^a-z0-9]/gi, '').toLowerCase(); }
  private customFile(console: string, title: string) {
    const dir = this.customDir(console), key = this.customKey(title);
    if (!dir || !key || !existsSync(dir)) return null;
    for (const ext of ['png', 'jpg', 'webp', 'gif']) { const f = join(dir, `${key}.${ext}`); if (existsSync(f)) return f; }
    return null;
  }
  private customCover(console: string, title: string) {
    const f = this.customFile(console, title);
    if (!f) return null;
    let v = 0; try { v = Math.round(statSync(f).mtimeMs); } catch { v = 0; }
    return `media://art/_custom/${console}/${f.slice(f.lastIndexOf(sep) + 1)}?v=${v}`;
  }
  /** Guarda a imagem escolhida como capa do jogo. Erro com a mensagem para o jogador se não for imagem. */
  async setCover(console: string, title: string, src: string) {
    const dir = this.customDir(console), key = this.customKey(title);
    if (!dir || !key) throw new Error(tt('Não dá para trocar a capa deste jogo.'));
    const st = await fsp.stat(src);
    if (st.size > COVER_MAX) throw new Error(tt('Imagem grande demais (máximo de 25 MB).'));
    const b = await fsp.readFile(src), type = imageType(b);
    if (!type) throw new Error(tt('Esse arquivo não é uma imagem PNG, JPG, WEBP ou GIF.'));
    await fsp.mkdir(dir, { recursive: true });
    await this.resetCover(console, title, false);
    await fsp.writeFile(join(dir, `${key}.${type}`), b);
    this.changed();
  }
  /** Volta para a capa baixada automaticamente. */
  async resetCover(console: string, title: string, notify = true) {
    for (let f = this.customFile(console, title); f; f = this.customFile(console, title)) await fsp.rm(f, { force: true });
    if (notify) this.changed();
  }

  private existing(platform: string, kind: ArtKind, key: string) {
    const f = this.folder(platform, kind);
    if (!existsSync(f)) return null;
    for (const ext of ['png', 'jpg', 'webp']) if (existsSync(join(f, `${key}.${ext}`))) return `${key}.${ext}`;
    return null;
  }
  private missingRecently(platform: string, kind: ArtKind, key: string) {
    const f = join(this.folder(platform, kind), `${key}.none`);
    try { return Date.now() - statSync(f).mtimeMs < NOT_FOUND_RETRY && readFileSync(f, 'utf8') === NONE_VERSION; } catch { return false; }
  }

  get(console: string, platformName: string | null | undefined, names: string[], kinds: ArtKind[] = ['cover', 'fanart', 'logo']): ArtSet {
    const platform = artPlatform(console, platformName);
    const key = looseKey(names[0] ?? '');
    const mine = kinds.includes('cover') ? this.customCover(console, names[0] ?? '') : null;
    if (!platform || !PLATFORMS[platform] || !key) return mine ? { cover: mine, custom: true } : {};
    const out: ArtSet = mine ? { cover: mine, custom: true } : {};
    for (const kind of kinds) {
      if (kind === 'cover' && mine) continue;
      const f = this.existing(platform, kind, key);
      if (f) out[kind] = `media://art/${platform}/${kind}/${f}`;
      else if (!this.missingRecently(platform, kind, key)) this.enqueue(platform, kind, key, names);
    }
    return out;
  }

  shots(console: string, platformName: string | null | undefined, names: string[]): string[] {
    const platform = artPlatform(console, platformName);
    const key = looseKey(names[0] ?? '');
    if (!platform || !PLATFORMS[platform] || !key) return [];
    const folder = this.folder(platform, 'screenshot');
    const files = existsSync(folder) ? readdirSync(folder).filter(f => f.startsWith(`${key}-`) && /^\d+\.(png|jpg|webp)$/.test(f.slice(key.length + 1))).sort() : [];
    if (files.length) return files.map(f => `media://art/${platform}/screenshot/${f}`);
    let recent = false;
    try { recent = Date.now() - statSync(join(folder, `${key}.shots`)).mtimeMs < NOT_FOUND_RETRY; } catch { recent = false; }
    if (!recent) this.enqueueShots(platform, key, names);
    return [];
  }

  private enqueueShots(platform: string, key: string, names: string[]) {
    const id = `${platform}/shots/${key}`;
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(async () => {
      try {
        let urls = (await this.lb.find(platform, names, 'screenshot')).slice(0, 4);
        if (!urls.length && this.libretro) urls = await this.libretro.find(platform, names, 'screenshot');
        const folder = this.folder(platform, 'screenshot');
        await fsp.mkdir(folder, { recursive: true });
        let n = 0;
        for (const url of urls) {
          const b = await this.image(url).catch(() => null);
          if (b) await fsp.writeFile(join(folder, `${key}-${n++}.${extOf(b)}`), b);
        }
        await fsp.writeFile(join(folder, `${key}.shots`), String(n));
        if (n) this.changed();
      } catch { } finally { this.pending.delete(id); }
    });
    this.pump();
  }

  private enqueue(platform: string, kind: ArtKind, key: string, names: string[]) {
    const id = `${platform}/${kind}/${key}`;
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(async () => {
      try {
        // Ordem: LaunchBox → libretro-thumbnails → Steam. Uma fonte fora do ar não impede as outras.
        // Só marca "sem imagem" se todas as fontes responderam; com alguma fora do ar, tenta de novo depois.
        let failed = false;
        const lbUrls = this.libretro ? await this.lb.find(platform, names, kind).catch(() => { failed = true; return [] as string[]; }) : await this.lb.find(platform, names, kind);
        const sources: (() => Promise<string[]>)[] = [async () => lbUrls];
        if (this.libretro && kind === 'cover') sources.push(() => this.libretro!.find(platform, names, 'cover'));
        if (platform === 'pc' || this.steamEverywhere) sources.push(async () => (await this.steamArt(names))?.[kind] ?? []);
        const folder = this.folder(platform, kind);
        await fsp.mkdir(folder, { recursive: true });
        for (const source of sources) {
          const urls = await source().catch(() => { failed = true; return [] as string[]; });
          for (const url of urls) {
            const b = await this.image(url).catch(() => { failed = true; return null; });
            if (b) { await fsp.writeFile(join(folder, `${key}.${extOf(b)}`), b); this.changed(); return; }
          }
        }
        if (!failed) await fsp.writeFile(join(folder, `${key}.none`), NONE_VERSION);
      } catch { }
      finally { this.pending.delete(id); }
    });
    this.pump();
  }
  private pump() {
    while (this.running < 4 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => { this.running--; this.pump(); });
    }
  }
  private steamArt(names: string[]): Promise<SteamArt | null> {
    const key = looseKey(names[0] ?? '');
    let p = this.steamCache.get(key);
    if (!p) { p = this.findSteamArt(names).catch(() => null); this.steamCache.set(key, p); }
    return p;
  }

  private async findSteamArt(names: string[]): Promise<SteamArt | null> {
    const keys = new Set(names.map(looseKey).filter(Boolean));
    const get = async <T>(url: string) => {
      const r = await this.fetch(url, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(tt('erro {0}', { 0: r.status }));
      return (await r.json()) as T;
    };
    const found = await get<{ items?: { type?: string; id?: number; name?: string }[] }>(`${this.steam.store}/api/storesearch/?term=${encodeURIComponent(cleanTitle(names[0] ?? ''))}&l=english&cc=US`);
    const app = (found.items ?? []).find(x => x.type === 'app' && x.id && keys.has(looseKey(x.name ?? '')));
    if (!app) return null;
    const input = { ids: [{ appid: app.id }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    const d = await get<{ response?: { store_items?: { assets?: Record<string, string> }[] } }>(`${this.steam.api}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    const a = d.response?.store_items?.[0]?.assets;
    const fmt = a?.asset_url_format;
    if (!a || !fmt) return null;
    const url = (f?: string) => (f ? [`${this.steam.cdn}${fmt.replace('${FILENAME}', f)}`] : []);
    return {
      cover: [...url(a.library_capsule_2x), ...url(a.library_capsule)],
      fanart: url(a.library_hero),
      logo: url(a.library_logo),
      screenshot: [],
    };
  }

  private async image(url: string): Promise<Buffer | null> {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'Cosmo' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404 || !r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length && b.length <= MAX_IMAGE && isImage(b) ? b : null;
  }
  private timer: NodeJS.Timeout | undefined;
  private changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.events.emit('changed'), 300); }

  async refresh() {
    for (const p of existsSync(this.dir) ? readdirSync(this.dir) : []) for (const k of Object.keys(KINDS)) {
      const f = this.folder(p, k as ArtKind);
      if (existsSync(f)) for (const n of readdirSync(f)) if (n.endsWith('.none') || n.endsWith('.shots')) await fsp.unlink(join(f, n)).catch(() => {});
    }
    await this.lb.load({ force: true });
    this.changed();
  }

  resolve(rel: string) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length !== 3 || parts.some(p => p === '..' || /[\\:]/.test(p))) return null;
    return join(this.dir, ...parts);
  }
}
