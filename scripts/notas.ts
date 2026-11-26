import { readFileSync, writeFileSync } from 'node:fs';
import { toConsoleId } from '../src/shared/consoles';
import { artPlatform } from '../src/main/artwork/service';
import { cleanTitle } from '../src/main/artwork/service';
import { type IgdbGame, igdbHasExact, matchIgdb, type NotaJogo, type Notas, pickIgdb, ttbHours, wikidataScore } from '../src/main/artwork/info';

const [prevFile, outFile = 'notas.json'] = process.argv.slice(2);
const CATALOG = process.env.CARTUCHO_CATALOG_URL || 'https://recompendium.com/unricopie/catalogo.json';
const UA = 'Cosmo/1.0 (https://github.com/GabrielGoris/cartucho)';
const DAY = 86400_000, KEEP_FOUND = 30 * DAY, KEEP_MISSING = 7 * DAY;
const MAX = Number(process.env.NOTAS_MAX || 3000), PAUSE = Number(process.env.NOTAS_PAUSE ?? 150);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const TWITCH_ID = process.env.TWITCH_CLIENT_ID ?? '', TWITCH_SECRET = process.env.TWITCH_CLIENT_SECRET ?? '';
const IGDB = process.env.IGDB_API || 'https://api.igdb.com/v4', TWITCH_TOKEN = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';
let token: string | null = null, igdbAt = 0;

async function igdbToken() {
  if (!TWITCH_ID || !TWITCH_SECRET) return null;
  const r = await fetch(`${TWITCH_TOKEN}?client_id=${encodeURIComponent(TWITCH_ID)}&client_secret=${encodeURIComponent(TWITCH_SECRET)}&grant_type=client_credentials`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`a Twitch recusou as credenciais do IGDB (${r.status})`);
  return ((await r.json()) as { access_token?: string }).access_token ?? null;
}

async function igdbPost<T>(path: string, body: string): Promise<T> {
  for (let tries = 1; ; tries++) {
    const wait = igdbAt + 300 - Date.now(); if (wait > 0) await sleep(wait);
    igdbAt = Date.now();
    const r = await fetch(`${IGDB}/${path}`, { method: 'POST', body, headers: { 'Client-ID': TWITCH_ID, Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) }).catch(e => e as Error);
    if (!(r instanceof Error) && r.ok) return (await r.json()) as T;
    const busy = r instanceof Error || r.status === 429 || r.status >= 500;
    if (!busy || tries >= 4) throw new Error(r instanceof Error ? r.message : `IGDB respondeu ${r.status}`);
    await sleep(3000 * tries);
  }
}

const IGDB_FIELDS = 'fields id,name,aggregated_rating,aggregated_rating_count,url,platforms.name';
const quoted = (title: string) => cleanTitle(title).replace(/["\\]/g, ' ');
const igdbSearch = (title: string) => igdbPost<IgdbGame[]>('games', `search "${quoted(title)}"; ${IGDB_FIELDS}; limit 10;`);
const igdbExact = (title: string) => igdbPost<IgdbGame[]>('games', `${IGDB_FIELDS}; where name ~ "${quoted(title)}"; limit 10;`);
async function igdbFind(title: string, platform: string | null) {
  const found = await igdbSearch(title);
  if (igdbHasExact(title, platform, found)) return found;
  const more = await igdbExact(title);
  return [...found, ...more.filter(x => !found.some(y => y.id === x.id))];
}

async function json<T>(url: string): Promise<T> {
  for (let tries = 1; ; tries++) {
    await sleep(PAUSE);
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }).catch(e => e as Error);
    if (!(r instanceof Error) && r.ok) return r.json() as Promise<T>;
    const busy = r instanceof Error || r.status === 429 || r.status >= 500;
    if (!busy || tries >= 4) throw new Error(r instanceof Error ? r.message : `erro ${r.status} em ${url}`);
    const wait = Number(!(r instanceof Error) && r.headers.get('retry-after')) || 5 * tries;
    await sleep(wait * 1000);
  }
}

interface Entry { entry?: string; nombre?: string; consola?: string | null; consola_nombre?: string | null; retirado?: boolean | null }

let prev: Notas = {};
try { if (prevFile) prev = JSON.parse(readFileSync(prevFile, 'utf8')) as Notas; } catch { prev = {}; }

token = await igdbToken().catch(e => { console.log(`::warning::${(e as Error).message}; seguindo só com o Wikidata`); return null; });
if (token && process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
console.log(token ? 'IGDB ligado' : 'IGDB desligado (sem TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET)');
const cat = await json<{ entradas?: Entry[] }>(CATALOG);
const now = Date.now(), out: Required<Notas> = { gerado: new Date(now).toISOString(), jogos: {} };
let asked = 0, found = 0, kept = 0, failed = 0, fromIgdb = 0, ttbAsked = 0;
const KEEP_TTB = 30 * DAY, ZV = 3, MIN_TTB_VOTES = 3;
const waitingTtb: [string, number][] = [];

for (const e of cat.entradas ?? []) {
  if (!e.entry || !e.nombre || e.retirado) continue;
  const old = prev.jogos?.[e.entry];
  const retryIgdb = !!token && old && (!old.i || (old.zv !== ZV && !old.n)) && (!old.n || old.n.by === 'OpenCritic');
  const needScore = !old || retryIgdb || now - old.t >= (old.n ? KEEP_FOUND : KEEP_MISSING);
  const needTtb = !!token && (!old?.zt || old.zv !== ZV || now - old.zt >= (old.z ? KEEP_TTB : KEEP_MISSING));
  if (!needScore && !needTtb) { out.jogos[e.entry] = old!; kept++; continue; }
  if (asked >= MAX) { if (old) out.jogos[e.entry] = old; continue; }
  asked++;
  const cid = toConsoleId(e.consola), platform = artPlatform(cid, e.consola_nombre ?? e.consola ?? 'Outros');
  try {
    let games: IgdbGame[] | null = null;
    const search = async () => (games ??= token ? await igdbFind(e.nombre!, platform) : []);
    const entry: NotaJogo = old ? { ...old } : { n: null, t: now };
    if (needScore) {
      let n = await wikidataScore(json, e.nombre, platform);
      if (token && (!n || n.by === 'OpenCritic')) {
        const ig = pickIgdb(e.nombre, platform, await search());
        if (ig && (!n || ig.platform)) { n = ig; fromIgdb++; }
      }
      entry.n = n; entry.t = now;
      if (token) entry.i = 1;
      if (n) found++;
    } else kept++;
    if (needTtb) {
      const g = matchIgdb(e.nombre, platform, await search());
      entry.zt = now;
      if (g?.id) { waitingTtb.push([e.entry, g.id]); ttbAsked++; } else entry.z = null;
    }
    if (token) entry.zv = ZV;
    out.jogos[e.entry] = entry;
  } catch (err) {
    failed++;
    if (old) out.jogos[e.entry] = old;
    console.warn(`${e.nombre}: ${(err as Error).message}`);
  }
}

let withTtb = 0;
for (let k = 0; k < waitingTtb.length; k += 400) {
  const part = waitingTtb.slice(k, k + 400);
  try {
    const rows = await igdbPost<{ game_id?: number; hastily?: number; normally?: number; completely?: number; count?: number }[]>('game_time_to_beats', `fields game_id,hastily,normally,completely,count; where game_id = (${part.map(x => x[1]).join(',')}); limit 500;`);
    const byGame = new Map(rows.filter(r => (r.count ?? 0) >= MIN_TTB_VOTES).map(r => [r.game_id, r]));
    for (const [entry, id] of part) { const z = ttbHours(byGame.get(id)); out.jogos[entry]!.z = z; if (z) withTtb++; }
  } catch (err) {
    console.warn(`tempo para zerar: ${(err as Error).message}`);
    for (const [entry] of part) { const o = prev.jogos?.[entry]; out.jogos[entry]!.z = o?.z ?? null; out.jogos[entry]!.zt = o?.zt; }
  }
}

writeFileSync(outFile, JSON.stringify(out));
const total = Object.keys(out.jogos).length, withScore = Object.values(out.jogos).filter(v => v.n).length;
const totalTtb = Object.values(out.jogos).filter(v => v.z).length;
console.log(`${total} jogos · ${withScore} com nota · ${totalTtb} com tempo para zerar · ${asked} consultados agora (${found} com nota, ${fromIgdb} pelo IGDB, ${withTtb} com tempo de ${ttbAsked}, ${failed} com erro) · ${kept} reaproveitados`);
