import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { Adapter, AdapterContext, AchievementDef, Definitions } from './adapters';
import type { Unlock } from './saves';
import { findKey, isMap, num, parseBinaryKV, type KV, type KVMap } from './vdf';
import { achNet, fetchImages, getJson, getText } from './net';
import { steamManifest, steamRoots } from '../steam';
import { tt } from '@shared/i18n';

/** Id numérico estável a partir do nome de API da conquista (FNV-1a de 31 bits). */
export function achId(api: string) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(api)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h & 0x7fffffff) || 1;
}

const CDN = (appid: string, icon: string) => `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}`;
const LANGS = () => (achNet.lang() === 'pt' ? ['brazilian', 'portuguese', 'english'] : ['english']);
function loc(v: KV | undefined): string {
  if (typeof v === 'string') return v;
  if (!isMap(v)) return '';
  for (const l of LANGS()) if (typeof v[l] === 'string' && v[l]) return v[l] as string;
  return Object.entries(v).find(([k, x]) => k !== 'token' && typeof x === 'string')?.[1] as string ?? '';
}
const yes = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

// ── Steam do próprio PC ────────────────────────────────────────────────

let regRoot: string | null | undefined;
function registryRoot() {
  if (regRoot !== undefined) return regRoot;
  regRoot = null;
  if (process.platform !== 'win32') return regRoot;
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = r.stdout?.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) regRoot = m[1]!.trim().replace(/\//g, '\\');
  } catch { }
  return regRoot;
}
/** Pasta da Steam que tem o appcache (a principal, não uma biblioteca extra). */
export function steamRootFor(installDir: string | null): string | null {
  const m = installDir?.match(/^(.*?)[\\/]steamapps[\\/]/i);
  const c = [m?.[1], registryRoot(), process.platform === 'win32' ? join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam') : null, ...(process.platform === 'linux' ? steamRoots() : [])];
  return c.find((p): p is string => !!p && existsSync(join(p, 'appcache', 'stats'))) ?? null;
}

export interface SchemaAch { api: string; stat: string; bit: number; name: string; desc: string; icon: string | null; hidden: boolean }
export function parseSchema(buf: Uint8Array): SchemaAch[] {
  const stats = findKey(parseBinaryKV(buf), 'stats', 3);
  if (!isMap(stats)) return [];
  const out: SchemaAch[] = [];
  for (const [statId, s] of Object.entries(stats)) {
    if (!isMap(s) || !isMap(s.bits)) continue;
    for (const [bk, b] of Object.entries(s.bits)) {
      if (!isMap(b) || typeof b.name !== 'string') continue;
      const d = isMap(b.display) ? b.display : {};
      out.push({ api: b.name, stat: statId, bit: num(b.bit) ?? Number(bk), name: loc(d.name) || b.name, desc: loc(d.desc), icon: typeof d.icon === 'string' && d.icon ? d.icon : null, hidden: yes(d.hidden) });
    }
  }
  return out.sort((a, b) => Number(a.stat) - Number(b.stat) || a.bit - b.bit);
}

/** UserGameStats_<conta>_<jogo>.bin: para cada stat de conquistas, um campo de bits e as datas por bit. */
export function parseUserStats(buf: Uint8Array, schema: SchemaAch[]): Unlock[] {
  const byStat = new Map<string, SchemaAch[]>();
  for (const a of schema) byStat.set(a.stat, [...(byStat.get(a.stat) ?? []), a]);
  const out: Unlock[] = [];
  const visit = (m: KVMap, depth: number) => {
    for (const [k, v] of Object.entries(m)) {
      const list = byStat.get(k);
      const bits = list ? (isMap(v) ? num(v.data) : num(v)) : null;
      if (list && bits != null) {
        const times = isMap(v) && isMap(v.AchievementTimes) ? v.AchievementTimes : null;
        for (const a of list) {
          if (((bits >>> a.bit) & 1) === 0) continue;
          const t = times ? num(times[String(a.bit)]) : null;
          out.push({ id: achId(a.api), at: t && t > 0 ? t * 1000 : null, name: a.api });
        }
      } else if (isMap(v) && depth < 4) visit(v, depth + 1);
    }
  };
  visit(parseBinaryKV(buf), 0);
  return out;
}

const statsDir = (root: string) => join(root, 'appcache', 'stats');
function userStatsFile(root: string, appid: string) {
  const dir = statsDir(root), re = new RegExp(`^UserGameStats_(\\d+)_${appid}\\.bin$`, 'i');
  let best: [string, number] | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!re.test(f)) continue;
      const t = statSync(join(dir, f)).mtimeMs;
      if (!best || t > best[1]) best = [join(dir, f), t];
    }
  } catch { }
  if (best) return best[0];
  let acc = '0';
  try {
    const t = readFileSync(join(root, 'config', 'loginusers.vdf'), 'utf8');
    const users = [...t.matchAll(/"(7656\d{13})"\s*\{([^}]*)\}/g)];
    const pick = users.find(u => /"MostRecent"\s*"1"/i.test(u[2]!)) ?? users[0];
    if (pick) acc = String(BigInt(pick[1]!) - 76561197960265728n);
  } catch { }
  return join(dir, `UserGameStats_${acc}_${appid}.bin`);
}
const schemaFile = (root: string, appid: string) => join(statsDir(root), `UserGameStatsSchema_${appid}.bin`);

function localSchema(installDir: string | null, appid: string) {
  const root = steamRootFor(installDir);
  const f = root ? schemaFile(root, appid) : null;
  if (!f || !existsSync(f)) return null;
  try { return parseSchema(new Uint8Array(readFileSync(f))); } catch { return null; }
}

async function withIcons(appid: string, list: (AchievementDef & { iconUrl?: string | null })[], origin: string, local?: Map<number, Uint8Array>): Promise<Definitions> {
  const urls = new Map(list.flatMap(a => (a.iconUrl && !local?.has(a.id) ? [[a.id, a.iconUrl] as [number, string]] : [])));
  const images = new Map([...(local ?? []), ...(await fetchImages(urls))]);
  void appid;
  return { list: list.map(({ iconUrl: _, ...a }) => a), images, origin };
}

async function fromLocalSchema(installDir: string | null, appid: string): Promise<Definitions | null> {
  const s = localSchema(installDir, appid);
  if (!s?.length) return null;
  return withIcons(appid, s.map(a => ({ id: achId(a.api), name: a.name, description: a.desc, points: null, iconUrl: a.icon ? CDN(appid, a.icon) : null })), tt('lista da Steam deste PC'));
}

interface WebAch { name: string; displayName?: string; description?: string; icon?: string; hidden?: number }
async function fromWebApi(appid: string): Promise<Definitions | null> {
  const key = achNet.steamKey();
  if (!key) return null;
  const l = achNet.lang() === 'pt' ? 'brazilian' : 'english';
  const r = await getJson<{ game?: { availableGameStats?: { achievements?: WebAch[] } } }>(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(key)}&appid=${appid}&l=${l}`);
  const list = r.game?.availableGameStats?.achievements ?? [];
  if (!list.length) return null;
  return withIcons(appid, list.map(a => ({ id: achId(a.name), name: a.displayName || a.name, description: a.description ?? '', points: null, iconUrl: a.icon ?? null })), tt('lista da API da Steam'));
}

/** Linhas da página pública de conquistas de um jogo (steamcommunity.com/stats/<jogo>/achievements), na ordem da página. */
export function parseCommunityPage(html: string): { name: string; desc: string; icon: string | null; pct: number | null }[] {
  const out: { name: string; desc: string; icon: string | null; pct: number | null }[] = [];
  const dec = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
  for (const block of html.split(/<div class="achieveRow\b/).slice(1)) {
    const name = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    if (name == null) continue;
    const desc = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? '';
    const icon = block.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null;
    const pct = block.match(/achievePercent[^>]*>\s*([\d.,]+)\s*%/)?.[1];
    out.push({ name: dec(name), desc: dec(desc), icon, pct: pct ? Number(pct.replace(',', '.')) : null });
  }
  return out;
}
/**
 * Casa os nomes de API (da porcentagem global, que não pede chave) com os nomes da página pública.
 * As duas listas vêm da mais desbloqueada para a menos; se os tamanhos e as porcentagens baterem, a ordem casa.
 */
export function matchByPercent(api: { name: string; percent: number }[], rows: { name: string; desc: string; icon: string | null; pct: number | null }[]) {
  if (!api.length || api.length !== rows.length) return null;
  const a = [...api].sort((x, y) => y.percent - x.percent);
  for (let i = 0; i < a.length; i++) {
    const p = rows[i]!.pct;
    if (p != null && Math.abs(p - a[i]!.percent) > 0.15) return null;
  }
  return a.map((x, i) => ({ api: x.name, ...rows[i]! }));
}
/**
 * Página nova de conquistas (steamcommunity.com/achievements/<jogo>): traz embutido, no JSON valve-ssr-data,
 * o nome de API, o nome, a descrição e o ícone de cada conquista no idioma pedido.
 */
export function parseCommunitySsr(html: string): { api: string; name: string; desc: string; icon: string | null }[] {
  const raw = html.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return [];
  type Ach = { api_name?: string; name?: string; description?: string; icon_achieved?: string };
  const out: { api: string; name: string; desc: string; icon: string | null }[] = [];
  try {
    const d = JSON.parse(raw) as { renderContext?: { queryData?: string } };
    const q = JSON.parse(d.renderContext?.queryData ?? '{}') as { queries?: { state?: { data?: { groups?: { achievements?: Ach[] }[] } } }[] };
    for (const x of q.queries ?? []) for (const g of x.state?.data?.groups ?? []) for (const a of g.achievements ?? []) {
      if (a.api_name && !out.some(o => o.api === a.api_name)) out.push({ api: a.api_name, name: a.name || a.api_name, desc: a.description ?? '', icon: a.icon_achieved || null });
    }
  } catch { return []; }
  return out;
}
async function fromCommunity(appid: string): Promise<Definitions | null> {
  const l = achNet.lang() === 'pt' ? 'brazilian' : 'english';
  const hdr = { 'Accept-Language': achNet.lang() === 'pt' ? 'pt-BR' : 'en' };
  const ssr = parseCommunitySsr(await getText(`https://steamcommunity.com/achievements/${appid}?l=${l}`, hdr).catch(() => ''));
  if (ssr.length) return withIcons(appid, ssr.map(a => ({ id: achId(a.api), name: a.name, description: a.desc, points: null, iconUrl: a.icon ? CDN(appid, a.icon) : null })), tt('lista pública da Steam'));
  const [g, html] = await Promise.all([
    getJson<{ achievementpercentages?: { achievements?: { name: string; percent: number | string }[] } }>(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null),
    getText(`https://steamcommunity.com/stats/${appid}/achievements/?l=${l}`, { 'Accept-Language': achNet.lang() === 'pt' ? 'pt-BR' : 'en' }).catch(() => ''),
  ]);
  const api = (g?.achievementpercentages?.achievements ?? []).map(a => ({ name: a.name, percent: Number(a.percent) || 0 }));
  const m = matchByPercent(api, parseCommunityPage(html));
  if (!m) return null;
  return withIcons(appid, m.map(x => ({ id: achId(x.api), name: x.name || x.api, description: x.desc, points: null, iconUrl: x.icon })), tt('lista pública da Steam'));
}

/** Porcentagem global de cada conquista na Steam (não pede chave). */
export async function steamRarity(appid: string | null): Promise<Map<number, number> | null> {
  if (!appid) return null;
  const g = await getJson<{ achievementpercentages?: { achievements?: { name: string; percent: number | string }[] } }>(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => null);
  const list = g?.achievementpercentages?.achievements ?? [];
  return list.length ? new Map(list.map(a => [achId(a.name), Math.max(0, Math.min(100, Number(a.percent) || 0))])) : null;
}

const NO_LIST = () => new Error(tt('A Steam deste PC não tem a lista deste jogo. Coloque uma chave da API da Steam nas configurações (Jogos) para o Cosmo buscar os nomes.'));

export const steamAppId = (ctx: AdapterContext) => steamManifest(ctx.installDir)?.appid ?? null;

export const steamLegit: Adapter = {
  id: 'steam',
  label: 'Steam',
  repos: [],
  detect: dir => !!steamManifest(dir),
  async definitions(ctx) {
    const appid = steamAppId(ctx);
    if (!appid) throw new Error(tt('não achei o número do jogo na Steam'));
    return (await fromLocalSchema(ctx.installDir, appid)) ?? (await fromWebApi(appid)) ?? (await fromCommunity(appid)) ?? (() => { throw NO_LIST(); })();
  },
  rarity: ctx => steamRarity(steamAppId(ctx)),
  unlockFile(ctx) {
    const appid = steamAppId(ctx), root = steamRootFor(ctx.installDir);
    return appid && root ? userStatsFile(root, appid) : '';
  },
  readUnlocks(buf, ctx) {
    const appid = steamAppId(ctx);
    const schema = appid ? localSchema(ctx.installDir, appid) : null;
    if (!schema) throw new Error(tt('a Steam deste PC ainda não baixou a lista deste jogo; abra o jogo pela Steam uma vez'));
    return parseUserStats(buf, schema);
  },
};

// ── Emuladores de Steam (Goldberg, o fork GSE, CODEX, RUNE) ───────────

export interface CrackInfo { appid: string; settings: string[]; tenoke?: string[] }
const scanCache = new Map<string, CrackInfo | null>();
const digits = (s: string) => s.match(/\d{2,10}/)?.[0] ?? null;

/** Acha o número do jogo na Steam dentro da pasta do jogo (até 3 níveis). */
export function scanCrack(dir: string): CrackInfo | null {
  if (scanCache.has(dir)) return scanCache.get(dir)!;
  let appid: string | null = null;
  const settings: string[] = [], tenoke: string[] = [];
  const queue: [string, number][] = [[dir, 0]];
  let seen = 0;
  while (queue.length && seen < 400) {
    const [d, depth] = queue.shift()!; seen++;
    let ents: import('node:fs').Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const n = e.name.toLowerCase(), p = join(d, e.name);
      try {
        if (e.isFile() && n === 'steam_appid.txt') appid ??= digits(readFileSync(p, 'utf8'));
        else if (e.isFile() && n === 'steam_emu.ini') appid ??= readFileSync(p, 'utf8').match(/^\s*AppId\s*=\s*(\d+)/im)?.[1] ?? null;
        else if (e.isFile() && n === 'tenoke.ini') { tenoke.push(p); appid ??= readFileSync(p, 'utf8').match(/^\s*id\s*=\s*(\d+)/im)?.[1] ?? null; }
        else if (e.isDirectory() && n === 'steam_settings') {
          settings.push(p);
          const f = join(p, 'steam_appid.txt'); if (existsSync(f)) appid ??= digits(readFileSync(f, 'utf8'));
        } else if (e.isDirectory() && depth < 3) queue.push([p, depth + 1]);
      } catch { }
    }
  }
  const r = appid ? { appid, settings, ...(tenoke.length ? { tenoke } : {}) } : null;
  scanCache.set(dir, r);
  return r;
}
export const clearCrackCache = () => scanCache.clear();

function publicDocs(ctx: AdapterContext) {
  return process.platform === 'win32' ? join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents') : join(ctx.appData, '..', '..', '..', 'Public', 'Documents');
}
function localSaveDirs(settings: string[]) {
  const out: string[] = [];
  for (const s of settings) {
    const base = dirname(s);
    for (const f of [join(base, 'local_save.txt'), join(s, 'local_save.txt')]) {
      try { const v = readFileSync(f, 'utf8').trim().split(/\r?\n/)[0]?.trim(); if (v) out.push(isAbsolute(v) ? v : join(base, v)); } catch { }
    }
    try {
      const v = readFileSync(join(s, 'configs.user.ini'), 'utf8').match(/^\s*local_save_path\s*=\s*(.+)$/im)?.[1]?.trim();
      if (v) out.push(isAbsolute(v) ? v : join(base, v));
    } catch { }
  }
  return out;
}
/** Pastas (que existem) onde os emuladores de Steam guardam conquistas e saves de um appid, fora da pasta do jogo. */
export function crackSaveDirs(appData: string, appid: string): string[] {
  const pub = publicDocs({ appData, installDir: '', title: '' });
  return [
    join(appData, 'GSE Saves', appid), join(appData, 'Goldberg SteamEmu Saves', appid),
    join(pub, 'Steam', 'CODEX', appid), join(appData, 'Steam', 'CODEX', appid), join(pub, 'Steam', 'RUNE', appid),
  ].filter(d => existsSync(d));
}

export function crackFiles(ctx: AdapterContext, info: CrackInfo) {
  const { appid } = info, pub = publicDocs(ctx);
  return [
    join(ctx.appData, 'GSE Saves', appid, 'achievements.json'),
    join(ctx.appData, 'Goldberg SteamEmu Saves', appid, 'achievements.json'),
    ...localSaveDirs(info.settings).map(d => join(d, appid, 'achievements.json')),
    join(pub, 'Steam', 'CODEX', appid, 'achievements.ini'),
    join(ctx.appData, 'Steam', 'CODEX', appid, 'achievements.ini'),
    join(pub, 'Steam', 'RUNE', appid, 'achievements.ini'),
    // TENOKE: SteamData/user_stats.ini na pasta do jogo.
    join(ctx.installDir, 'SteamData', 'user_stats.ini'),
  ];
}

/** achievements.json do Goldberg/GSE ou achievements.ini do CODEX/RUNE. */
export function readEmuUnlocks(buf: Uint8Array): Unlock[] {
  const text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
  const out: Unlock[] = [];
  if (/^\s*\{/.test(text)) {
    const j = JSON.parse(text) as Record<string, { earned?: unknown; earned_time?: unknown }>;
    for (const [api, v] of Object.entries(j)) {
      if (!v || !yes(v.earned)) continue;
      const t = Number(v.earned_time);
      out.push({ id: achId(api), at: t > 0 ? t * 1000 : null, name: api });
    }
    return out;
  }
  let sec: string | null = null, kv: Record<string, string> = {};
  const flush = () => {
    if (sec && !/^steamachievements$/i.test(sec) && yes(kv.achieved?.trim())) {
      const t = Number(kv.unlocktime);
      out.push({ id: achId(sec), at: t > 0 ? t * 1000 : null, name: sec });
    }
  };
  for (const line of text.split(/\r?\n/)) {
    // TENOKE (user_stats.ini): "nome" = {unlocked = true, time = 1761262906}
    const tk = line.match(/^\s*"?([^"=\s]+)"?\s*=\s*\{([^}]*)\}/);
    if (tk) {
      const body = tk[2]!;
      if (/unlocked\s*=\s*true/i.test(body)) { const t = Number(body.match(/time\s*=\s*(\d+)/i)?.[1]); out.push({ id: achId(tk[1]!), at: t > 0 ? t * 1000 : null, name: tk[1]! }); }
      continue;
    }
    const s = line.match(/^\s*\[(.+)\]\s*$/);
    if (s) { flush(); sec = s[1]!.trim(); kv = {}; continue; }
    const m = line.match(/^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/);
    if (m) kv[m[1]!.toLowerCase()] = m[2]!;
  }
  flush();
  return out;
}

/** tenoke.ini: [ACHIEVEMENTS.nome] com icon/hidden, e [ACHIEVEMENTS.nome.name] / [.desc] com um texto por idioma. */
export function parseTenoke(text: string) {
  const order: string[] = [], info = new Map<string, { icon?: string; name: Record<string, string>; desc: Record<string, string> }>();
  let cur: { api: string; part: 'main' | 'name' | 'desc' } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const s = line.match(/^\[ACHIEVEMENTS\.(.+?)(?:\.(name|desc))?\]$/);
    if (s) {
      const api = s[1]!; if (!info.has(api)) { info.set(api, { name: {}, desc: {} }); order.push(api); }
      cur = { api, part: (s[2] as 'name' | 'desc' | undefined) ?? 'main' }; continue;
    }
    if (/^\[/.test(line)) { cur = null; continue; }
    const m = cur && line.match(/^([\w-]+)\s*=\s*"?(.*?)"?$/);
    if (!m || !cur) continue;
    const a = info.get(cur.api)!;
    if (cur.part === 'main') { if (m[1] === 'icon') a.icon = m[2]; }
    else a[cur.part][m[1]!.toLowerCase()] = m[2]!;
  }
  const pick = (o: Record<string, string>) => { for (const l of LANGS()) if (o[l]) return o[l]!; return Object.values(o)[0] ?? ''; };
  return order.map(api => { const a = info.get(api)!; return { api, name: pick(a.name) || api, desc: pick(a.desc), icon: a.icon ?? null }; });
}
async function fromTenoke(info: CrackInfo): Promise<Definitions | null> {
  for (const f of info.tenoke ?? []) {
    let list: ReturnType<typeof parseTenoke>;
    try { list = parseTenoke(await readFile(f, 'utf8')); } catch { continue; }
    if (!list.length) continue;
    return withIcons(info.appid, list.map(a => ({ id: achId(a.api), name: a.name, description: a.desc, points: null, iconUrl: a.icon ? (/^https?:/i.test(a.icon) ? a.icon : CDN(info.appid, a.icon)) : null })), tt('lista que veio com o jogo (tenoke.ini)'));
  }
  return null;
}

interface GseAch { name: string; displayName?: unknown; description?: unknown; icon?: string }
async function fromSettings(info: CrackInfo): Promise<Definitions | null> {
  for (const s of info.settings) {
    const f = join(s, 'achievements.json');
    if (!existsSync(f)) continue;
    let list: GseAch[];
    try { list = JSON.parse((await readFile(f, 'utf8')).replace(/^\uFEFF/, '')) as GseAch[]; } catch { continue; }
    if (!Array.isArray(list) || !list.length) continue;
    const txt = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' ? loc(v as KVMap) : '');
    const local = new Map<number, Uint8Array>();
    const defs = list.filter(a => a && typeof a.name === 'string').map(a => {
      const id = achId(a.name);
      let iconUrl: string | null = null;
      if (a.icon && /^https?:/i.test(a.icon)) iconUrl = a.icon;
      else if (a.icon) { const p = isAbsolute(a.icon) ? a.icon : join(s, a.icon); try { local.set(id, new Uint8Array(readFileSync(p))); } catch { } }
      return { id, name: txt(a.displayName) || a.name, description: txt(a.description), points: null, iconUrl };
    });
    return withIcons(info.appid, defs, tt('lista que veio com o jogo (steam_settings)'), local);
  }
  return null;
}

export const steamEmu: Adapter = {
  id: 'steam-emu',
  label: tt('Emulador de Steam'),
  repos: [],
  detect: dir => !steamManifest(dir) && !!scanCrack(dir),
  async definitions(ctx) {
    const info = scanCrack(ctx.installDir);
    if (!info) throw new Error(tt('não achei o número do jogo na Steam dentro da pasta'));
    return (await fromTenoke(info)) ?? (await fromSettings(info)) ?? (await fromLocalSchema(null, info.appid)) ?? (await fromWebApi(info.appid)) ?? (await fromCommunity(info.appid)) ?? (() => { throw NO_LIST(); })();
  },
  unlockFile(ctx) {
    const info = scanCrack(ctx.installDir);
    if (!info) return '';
    const files = crackFiles(ctx, info);
    let best: [string, number] | null = null;
    for (const f of files) { try { const t = statSync(f).mtimeMs; if (!best || t > best[1]) best = [f, t]; } catch { } }
    return best?.[0] ?? files[0]!;
  },
  watchFiles(ctx) { const info = scanCrack(ctx.installDir); return info ? crackFiles(ctx, info) : []; },
  rarity: ctx => steamRarity(scanCrack(ctx.installDir)?.appid ?? null),
  readUnlocks: buf => readEmuUnlocks(buf),
};
