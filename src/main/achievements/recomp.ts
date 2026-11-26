import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Adapter, AdapterContext } from './adapters';
import { readHedgeAch, type Unlock } from './saves';
import { achId } from './steam';
import { discoverList } from './discover';
import { tt } from '@shared/i18n';

/**
 * Conquistas e troféus que os próprios recomps guardam (cada projeto do seu jeito).
 * Procura os nomes de arquivo mais usados na pasta do jogo e na pasta do usuário que o recomp cria
 * em AppData, e reconhece o formato pelo conteúdo: ACH-DATA (hedge-dev), linhas de texto, JSON, JSON por linha e INI.
 */
const NAMES = new Set(['ach-data', 'trophies.txt', 'trophies.jsonl', 'trophies.json', 'achievements.txt', 'achievements.json', 'achievements.ini', 'port_achievements.txt', 'earned.tsv']);
/** Além dos nomes conhecidos, qualquer arquivo de texto com "achiev"/"troph"/"earned" no nome (o conteúdo diz se é de desbloqueios). */
const LIKELY = /^(?:.*(?:achiev|troph|cheev)[^.]*|earned|unlocked)\.(?:txt|jsonl|json|ini|tsv)$/i;
/** Arquivos de nomes/textos/listas são definições, nunca desbloqueios. */
const DEFS_NAME = /name|text|list|catalog|def|desc|schema|lang|conf|key|iv\b/i;
const SKIP = /^(steam_settings|node_modules|\.git|shaders?|cache|assets?|data|content|media|music|movies?|video|sound|audio|textures?|game|patched|decrypted|dlc)$/i;

const SKIP_FUNDO = /^(\.git|node_modules|shaders?|cache|movies?|videos?|textures?)$/i;
function scan(root: string, maxDepth: number, out: string[], extra?: Set<string>) {
  // Com nomes vindos do índice, desce mais e entra em game/data/content (onde alguns kits guardam os perfis).
  if (extra) maxDepth = 5;
  const skip = extra ? SKIP_FUNDO : SKIP;
  const q: [string, number][] = [[root, 0]];
  let seen = 0;
  while (q.length && seen < (extra ? 800 : 300)) {
    const [d, depth] = q.shift()!; seen++;
    let ents: Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isFile() && (extra?.has(e.name.toLowerCase()) || NAMES.has(e.name.toLowerCase()) || (LIKELY.test(e.name) && !DEFS_NAME.test(e.name)))) out.push(join(d, e.name));
      else if (e.isDirectory() && depth < maxDepth && !skip.test(e.name)) q.push([join(d, e.name), depth + 1]);
    }
  }
}
/** Pastas que o recomp cria em AppData com o nome do programa (ex.: %APPDATA%\TDURecomp). */
function userRoots(ctx: AdapterContext) {
  const out = new Set<string>();
  let exes: string[] = [];
  try { exes = readdirSync(ctx.installDir).filter(n => /\.exe$|recomp$|port$/i.test(n)); } catch { }
  for (const n of exes) {
    const b = basename(n, extname(n));
    for (const base of [ctx.appData, join(ctx.appData, '..', 'Local')]) { const p = join(base, b); if (existsSync(p)) out.add(p); }
  }
  return [...out];
}
const cache = new Map<string, { at: number; files: string[] }>();
export function recompFiles(ctx: AdapterContext, extra?: Set<string>): string[] {
  const ck = ctx.installDir + (extra ? `|${[...extra].sort().join(',')}` : '');
  const c = cache.get(ck);
  if (c && Date.now() - c.at < 60_000) return c.files;
  const found: string[] = [];
  scan(ctx.installDir, 3, found, extra);
  for (const r of userRoots(ctx)) scan(r, 3, found, extra);
  // Fica com os de nome conhecido e com os outros que, pelo conteúdo, guardam desbloqueios (não uma lista de definições).
  const files = found.filter(f => NAMES.has(f.split(/[\\/]/).pop()!.toLowerCase()) || (() => { try { const b = readFileSync(f); return b.length < 2_000_000 && readRecompFile(new Uint8Array(b), f).length > 0; } catch { return false; } })());
  cache.set(ck, { at: Date.now(), files });
  return files;
}
export const recompRoots = (ctx: AdapterContext) => [ctx.installDir, ...userRoots(ctx)];

const toMs = (v: unknown) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
};
export const idOf = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : typeof v === 'string' && v ? achId(v) : null);
const nameOf = (v: unknown) => (typeof v === 'string' && v && !/^\d+$/.test(v) ? v : undefined);
function fromObj(o: Record<string, unknown>, key?: string): Unlock | null {
  if (o.unlocked === false || o.earned === false || o.achieved === false || o.achieved === 0) return null;
  // Um objeto com nome/descrição e sem nenhuma marca de desbloqueio é a definição da conquista, não um desbloqueio.
  const marked = [o.unlocked, o.earned, o.achieved, o.done, o.completed].some(v => v === true || v === 1 || v === '1') || [o.time, o.unix, o.timestamp, o.unlocked_at, o.unlockedAt, o.earned_time, o.date, o.at].some(v => v != null && v !== 0 && v !== '');
  if (!marked && ['description', 'desc', 'displayName', 'display_name', 'title', 'icon'].some(k => k in o)) return null;
  const id = idOf(o.id ?? o.trophy ?? o.trophy_id ?? o.trophyId ?? o.achievement ?? o.achievement_id ?? o.key ?? key);
  if (id == null) return null;
  const at = toMs(o.time ?? o.unix ?? o.timestamp ?? o.unlocked_at ?? o.unlockedAt ?? o.earned_time ?? o.date ?? o.at);
  const name = nameOf(o.name) ?? nameOf(o.title) ?? (typeof (o.id ?? key) === 'string' ? nameOf(o.id ?? key) : undefined);
  return { id, at, ...(name ? { name } : {}) };
}

/** Lê um arquivo de conquistas de recomp pelo conteúdo. */
export function readRecompFile(buf: Uint8Array, file = ''): Unlock[] {
  if (/ach-data$/i.test(file) || (buf[0] === 0x41 && buf[1] === 0x43 && buf[2] === 0x48 && buf[3] === 0x20)) return readHedgeAch(buf);
  const text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '').trim();
  if (!text) return [];
  const out: Unlock[] = [];
  const push = (u: Unlock | null) => { if (u && !out.some(x => x.id === u.id)) out.push(u); };
  if (/\.jsonl$/i.test(file) || (/^\{/.test(text) && /\}\s*\r?\n\s*\{/.test(text))) {
    for (const line of text.split(/\r?\n/)) { try { push(fromObj(JSON.parse(line) as Record<string, unknown>)); } catch { } }
    return out;
  }
  let j: unknown = undefined;
  if (!/\.ini$/i.test(file) && /^[[{]/.test(text)) { try { j = JSON.parse(text); } catch { j = undefined; } }
  if (j !== undefined) {
    const list = Array.isArray(j) ? j : j && typeof j === 'object' ? ((j as Record<string, unknown>).unlocked ?? (j as Record<string, unknown>).trophies ?? (j as Record<string, unknown>).achievements ?? j) : [];
    if (Array.isArray(list)) for (const x of list) push(typeof x === 'object' && x ? fromObj(x as Record<string, unknown>) : idOf(x) != null ? { id: idOf(x)!, at: null } : null);
    else if (list && typeof list === 'object') for (const [k, v] of Object.entries(list)) push(v && typeof v === 'object' ? fromObj(v as Record<string, unknown>, k) : v === true || typeof v === 'number' ? { id: idOf(k)!, at: typeof v === 'number' ? toMs(v) : null } : null);
    return out;
  }
  if (/^\s*\[[^\]]+\]/m.test(text) || /^\s*\d+\s*=\s*\S/m.test(text)) {
    let sec: string | null = null;
    for (const line of text.split(/\r?\n/)) {
      const s = line.match(/^\s*\[(.+)\]\s*$/);
      if (s) {
        sec = s[1]!.trim();
        // rexglue (recomps de Xbox 360): [unlocked.<id>] com filetime (100 ns desde 1601) na linha de baixo.
        const u = sec.match(/^unlocked\.(.+)$/i); if (u) push({ id: idOf(u[1]!.replace(/^"|"$/g, ''))!, at: null });
        continue;
      }
      const m = line.match(/^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/); if (!m) continue;
      const [k, v] = [m[1]!, m[2]!];
      const un = sec?.match(/^unlocked\.(.+)$/i);
      if (un && /^filetime$/i.test(k)) { const ft = Number(v); const last = out.find(x => x.id === idOf(un[1]!.replace(/^"|"$/g, ''))); if (last && ft > 0) last.at = ft > 1e16 ? Math.round(ft / 10_000 - 11_644_473_600_000) : toMs(ft); continue; }
      if (sec && /^(achieved|unlocked|earned)$/i.test(k) && /^(1|true)$/i.test(v)) push({ id: idOf(sec)!, at: null, ...(nameOf(sec) ? { name: sec } : {}) });
      else if (!sec && /^\d+$/.test(k) && v && !/^(0|false)$/i.test(v)) push({ id: Number(k), at: toMs(v) });
    }
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || /^[#;/]/.test(t)) continue;
    const parts = t.split(/\t|\s+/);
    const id = idOf(parts[0]); if (id == null) continue;
    const at = parts[1] && /^\d{9,13}$/.test(parts[1]) ? toMs(parts[1]) : null;
    const rest = t.split(/\t/).length > 2 ? t.split(/\t/).slice(at ? 2 : 1).join(' ') : parts.slice(at ? 2 : 1).join(' ');
    push({ id, at, ...(rest && !/^\d+$/.test(rest) ? { name: rest } : nameOf(parts[0]) ? { name: parts[0] } : {}) });
  }
  return out;
}

export const recompLocal: Adapter = {
  id: 'recomp-local',
  label: tt('Conquistas do recomp'),
  repos: [],
  detect: dir => recompFiles({ installDir: dir, appData: process.env.APPDATA ?? join(dir, '__') }).length > 0,
  async definitions(ctx) {
    // Sem leitor feito à mão: procura perto dos arquivos do jogo uma lista com nomes que case com o que foi desbloqueado.
    const wanted = new Set<number>();
    const f = recompLocal.unlockFile(ctx);
    if (f) { try { for (const u of readRecompFile(new Uint8Array(readFileSync(f)), f)) wanted.add(u.id); } catch { } }
    const key = (k: string) => idOf(k);
    const found = discoverList(recompRoots(ctx), wanted, key);
    if (!found) return { list: [], origin: tt('arquivo de conquistas do próprio recomp') };
    const images = new Map<number, Uint8Array>();
    for (const [k, b] of found.icons) { const i = key(k); if (i != null) images.set(i, b); }
    const seen = new Set<number>();
    const list = found.defs.flatMap(d => { const id = key(d.key); if (id == null || seen.has(id)) return []; seen.add(id); return [{ id, name: d.name, description: d.desc, points: null }]; });
    return { list, images, origin: tt('lista encontrada em {0}', { 0: found.file.split(/[\\/]/).slice(-2).join('/') }) };
  },
  refreshDefs: true,
  unlockFile(ctx) {
    const files = recompFiles(ctx);
    let best: [string, number] | null = null;
    for (const f of files) { try { const t = statSync(f).mtimeMs; if (!best || t > best[1]) best = [f, t]; } catch { } }
    return best?.[0] ?? '';
  },
  watchFiles: ctx => recompFiles(ctx),
  readUnlocks(buf, ctx) { return readRecompFile(buf, recompLocal.unlockFile(ctx)); },
};
