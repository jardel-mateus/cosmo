import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { achNet } from './net';

/**
 * Descoberta genérica da lista de conquistas de um recomp, sem leitor feito à mão para cada projeto.
 * Procura arquivos que pareçam listas (JSON, HTML, INI/TOML, TSV/CSV/texto) perto da pasta do jogo e da do usuário,
 * extrai deles (nome interno, nome, descrição) do jeito que der e fica com a lista que mais casa com o que foi desbloqueado.
 * Os ícones são imagens com o mesmo nome interno da conquista.
 */
export interface FoundDef { key: string; name: string; desc: string }

/** Nome legível a partir do nome interno: "relic_1" → "Relic 1", "firstEvo" → "First evo", "12" → "Conquista 12". */
export function humanize(id: string, numbered = (n: string) => `Conquista ${n}`): string {
  const t = id.trim();
  if (/^\d+$/.test(t)) return numbered(t);
  const s = t.replace(/^(ach(ievement)?|trophy|troph|ach)[_\-.:]+/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : t;
}

const LANG_KEYS = () => (achNet.lang() === 'pt' ? ['pt-br', 'pt_br', 'ptbr', 'brazilian', 'portuguese', 'pt', 'en', 'en-us', 'english'] : ['en', 'en-us', 'english']);
function text(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>, low = Object.fromEntries(Object.entries(o).map(([k, x]) => [k.toLowerCase(), x]));
    for (const k of LANG_KEYS()) if (typeof low[k] === 'string' && low[k]) return (low[k] as string).trim();
    const first = Object.values(o).find(x => typeof x === 'string'); return typeof first === 'string' ? first.trim() : '';
  }
  return '';
}
const KEY_FIELDS = ['api_name', 'apiname', 'api', 'id', 'key', 'achievement_id', 'achievementid', 'trophy_id', 'trophyid', 'ach_id', 'internal_name', 'code'];
const NAME_FIELDS = ['displayname', 'display_name', 'title', 'label', 'localized_name', 'name'];
const DESC_FIELDS = ['description', 'desc', 'text', 'details', 'detail', 'unlocked_text', 'subtitle', 'hint'];
function fromObject(o: Record<string, unknown>, mapKey?: string): FoundDef | null {
  const low = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  let key = KEY_FIELDS.map(k => low[k]).find(v => typeof v === 'string' || typeof v === 'number');
  const nameField = NAME_FIELDS.find(k => low[k] != null && text(low[k]) && !(k === 'name' && key == null && mapKey == null));
  if (key == null && mapKey != null) key = mapKey;
  if (key == null && nameField !== 'name' && typeof low.name === 'string') key = low.name;
  if (key == null || !nameField) return null;
  const name = text(low[nameField]);
  if (!name || String(key) === name && !DESC_FIELDS.some(k => low[k])) return null;
  const desc = DESC_FIELDS.map(k => text(low[k])).find(Boolean) ?? '';
  return { key: String(key), name, desc };
}
function fromJson(v: unknown, out: FoundDef[][], depth = 0) {
  if (depth > 6 || v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    const list = v.flatMap(x => (x && typeof x === 'object' && !Array.isArray(x) ? [fromObject(x as Record<string, unknown>)].filter((d): d is FoundDef => !!d) : []));
    if (list.length >= 2) out.push(list);
    for (const x of v.slice(0, 50)) fromJson(x, out, depth + 1);
    return;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  const keyed = entries.flatMap(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? [fromObject(x as Record<string, unknown>, k)].filter((d): d is FoundDef => !!d) : []));
  if (keyed.length >= 2) out.push(keyed);
  for (const [, x] of entries) fromJson(x, out, depth + 1);
}
const dec = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, ' ').trim();
function fromHtml(html: string): FoundDef[] {
  const out: FoundDef[] = [];
  const blocks = html.match(/<(li|tr|article)\b[\s\S]*?<\/\1>/gi) ?? html.match(/<div[^>]+class="[^"]*(ach|troph|cheev)[^"]*"[\s\S]*?<\/div>/gi) ?? [];
  for (const b of blocks) {
    const key = b.match(/data-(?:id|key|api|name)="([^"]+)"/i)?.[1] ?? b.match(/<img[^>]+src="[^"]*?([^"/\\]+)\.(?:png|jpe?g|webp|gif)"/i)?.[1];
    const name = b.match(/<(b|strong|h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? b.match(/class="[^"]*(?:name|title)[^"]*"[^>]*>([\s\S]*?)</i)?.[1];
    if (!key || name == null) continue;
    const desc = (b.match(/<(small|p|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? b.match(/class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)</i)?.[1] ?? '');
    const n = dec(name);
    if (n && !out.some(o => o.key === key)) out.push({ key, name: n, desc: dec(desc).replace(/\s*(Earned|Unlocked|Desbloquead[ao])\b[\s\S]*$/i, '') });
  }
  return out;
}
function fromIni(t: string): FoundDef[] {
  const by = new Map<string, { name?: string; desc?: string; langs: Record<string, string>; dlangs: Record<string, string> }>();
  let sec: string | null = null, part: 'main' | 'name' | 'desc' = 'main';
  // TOML com [[achievements]] (uma tabela por conquista, com id/label/description): cada bloco vira uma entrada.
  if (/^\s*\[\[[^\]]+\]\]\s*$/m.test(t)) {
    const out: FoundDef[] = [];
    for (const bloco of t.split(/^\s*\[\[[^\]]+\]\]\s*$/m).slice(1)) {
      const kv: Record<string, string> = {};
      for (const l of bloco.split(/\r?\n/)) { const m = l.match(/^\s*([\w.-]+)\s*=\s*"?(.*?)"?\s*$/); if (m) kv[m[1]!.toLowerCase()] = m[2]!; }
      const key = kv.id ?? kv.api_name ?? kv.key, name = kv.label ?? kv.name ?? kv.title ?? kv.displayname;
      if (key && name) out.push({ key, name, desc: kv.description ?? kv.desc ?? kv.unachieved_description ?? '' });
    }
    return out;
  }
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/\s+[#;].*$/, '').trim();
    const s = line.match(/^\[+\s*(.+?)\s*\]+$/);
    if (s) {
      let k = s[1]!.replace(/^(achievements?|trophies|trophy)\./i, '');
      const m = k.match(/^(.+)\.(name|desc|description|title)$/i); part = 'main';
      if (m) { k = m[1]!; part = /name|title/i.test(m[2]!) ? 'name' : 'desc'; }
      sec = k; if (!by.has(k)) by.set(k, { langs: {}, dlangs: {} }); continue;
    }
    const kv = line.match(/^([\w.-]+)\s*[=:]\s*"?(.*?)"?$/); if (!kv || !sec) continue;
    const e = by.get(sec)!, k = kv[1]!.toLowerCase(), v = kv[2]!;
    if (part === 'name') e.langs[k] = v; else if (part === 'desc') e.dlangs[k] = v;
    else if (['name', 'title', 'displayname', 'display_name'].includes(k)) e.name ??= v;
    else if (['desc', 'description', 'text'].includes(k)) e.desc ??= v;
  }
  return [...by].flatMap(([key, e]) => { const name = e.name ?? text(e.langs); return name ? [{ key, name, desc: e.desc ?? text(e.dlangs) }] : []; });
}
function fromLines(t: string): FoundDef[] {
  const out: FoundDef[] = [];
  for (const line of t.split(/\r?\n/)) {
    const f = (line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.includes('|') ? line.split('|') : []).map(x => x.trim().replace(/^"|"$/g, ''));
    if (f.length < 2 || !f[0] || /\s/.test(f[0])) continue;
    const words = f.slice(1).filter(x => x && !/^[\d.:-]+$/.test(x) && !/^(bronze|silver|gold|platinum|base|dlc\d*|[bsgp]|true|false)$/i.test(x));
    if (words.length) out.push({ key: f[0], name: words[0]!, desc: words[1] ?? '' });
  }
  return out.length >= 2 ? out : [];
}
/** Todas as listas que dá para tirar de um arquivo. */
export function extractDefs(content: string, file = ''): FoundDef[][] {
  const t = content.replace(/^﻿/, ''), ext = extname(file).toLowerCase(), out: FoundDef[][] = [];
  if (/^\s*[[{]/.test(t)) { try { fromJson(JSON.parse(t), out); } catch { } }
  if (ext === '.html' || ext === '.htm' || /<(li|tr|article|div)\b/i.test(t)) { const h = fromHtml(t); if (h.length >= 2) out.push(h); }
  if (/^\s*\[{1,2}[^\]\n]+\]{1,2}\s*$/m.test(t)) { const i = fromIni(t); if (i.length >= 2) out.push(i); }
  const l = fromLines(t); if (l.length) out.push(l);
  return out;
}

const LIST_NAME = /achiev|troph|cheev|award|badge|catalog|ach[-_.]?data|earned/i;
const LIST_EXT = new Set(['.json', '.html', '.htm', '.ini', '.toml', '.tsv', '.csv', '.txt', '.cfg']);
const SKIP = /^(steam_settings|node_modules|\.git|shaders?|cache|textures?|movies?|videos?|sound|audio|music|patched|decrypted)$/i;
function walk(root: string, depth: number, keep: (p: string, e: Dirent) => boolean, max = 400) {
  const out: string[] = [], q: [string, number][] = [[root, 0]];
  let seen = 0;
  while (q.length && seen < max) {
    const [d, dep] = q.shift()!; seen++;
    let ents: Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isFile() && keep(p, e)) out.push(p);
      else if (e.isDirectory() && dep < depth && !SKIP.test(e.name)) q.push([p, dep + 1]);
    }
  }
  return out;
}

export interface Discovered { defs: FoundDef[]; file: string; icons: Map<string, Uint8Array> }
/**
 * Escolhe a melhor lista nas pastas: a que tem mais nomes internos que aparecem nos desbloqueios (`wanted`),
 * e depois a mais comprida. `idOf` converte o nome interno no mesmo id que os desbloqueios usam.
 */
export function discoverList(roots: string[], wanted: Set<number>, idOf: (k: string) => number | null): Discovered | null {
  let best: { defs: FoundDef[]; file: string; score: number } | null = null;
  for (const root of roots) {
    for (const f of walk(root, 3, (p, e) => LIST_EXT.has(extname(e.name).toLowerCase()) && LIST_NAME.test(e.name) && (() => { try { return statSync(p).size < 2_000_000; } catch { return false; } })())) {
      let content = '';
      try { content = readFileSync(f, 'utf8'); } catch { continue; }
      for (const defs of extractDefs(content, f)) {
        const hits = defs.filter(d => { const i = idOf(d.key); return i != null && wanted.has(i); }).length;
        if (wanted.size && !hits && defs.length < 5) continue;
        const score = hits * 1000 + defs.length;
        if (!best || score > best.score) best = { defs, file: f, score };
      }
    }
  }
  if (!best) return null;
  return { defs: best.defs, file: best.file, icons: findIcons(best.defs.map(d => d.key), [dirname(best.file), ...roots]) };
}

/** Imagens com o mesmo nome interno da conquista (ex.: img/relic_1.png), perto da lista ou nas pastas do jogo. */
export function findIcons(keys: string[], dirs: string[]): Map<string, Uint8Array> {
  const want = new Set(keys.map(k => k.toLowerCase())), out = new Map<string, Uint8Array>();
  for (const d of [...new Set(dirs)]) {
    for (const f of walk(d, 2, (_p, e) => /\.(png|jpe?g|webp|gif)$/i.test(e.name) && want.has(e.name.replace(/\.[^.]+$/, '').toLowerCase()), 150)) {
      const k = keys.find(x => x.toLowerCase() === f.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').toLowerCase())!;
      if (out.has(k)) continue;
      try { const b = readFileSync(f); if (b.length < 1_000_000) out.set(k, new Uint8Array(b)); } catch { }
    }
    if (out.size >= want.size) break;
  }
  return out;
}
