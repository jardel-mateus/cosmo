import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { Adapter, AdapterContext, Definitions } from './adapters';
import { readHedgeAch, type Unlock } from './saves';
import { readEmuUnlocks, parseTenoke } from './steam';
import { readRecompFile, recompFiles, recompRoots, idOf } from './recomp';
import { readEarnedTsv } from './recompia';
import { discoverList, extractDefs, findIcons } from './discover';
import { achNet, fetchImages, getJson } from './net';
import { tt } from '@shared/i18n';
import EMBUTIDO from './data/indice.json';

/**
 * Índice de conquistas dos recomps (conquistas.json no ramo `dados` do repositório; uma cópia vem dentro do app).
 * Para cada projeto, pelo repositório do GitHub, diz onde procurar os desbloqueios e a lista, sem leitor feito à mão no app.
 * Caminhos aceitam {jogo}, {appdata}, {localappdata}, {documentos}, {publico}, {usuario}, {jogos_salvos}, {id} (nos ícones) e * num trecho.
 */
export type Formato = 'auto' | 'hedge' | 'linhas' | 'jsonl' | 'json' | 'ini' | 'tenoke' | 'goldberg' | 'earned' | 'binario';
export interface Fonte { caminho?: string; url?: string; formato?: Formato }
export interface Entrada {
  repos: string[];
  /** Nomes de arquivo a procurar nas pastas do jogo (gerado automaticamente pelo varredor). */
  procurar?: string[];
  desbloqueios?: Fonte[];
  lista?: Fonte[];
  /** Lista escrita à mão, quando o projeto não tem uma em arquivo. */
  conquistas?: { id: string; nome: string; desc?: string; icone?: string }[];
  icones?: string;
  nota?: string;
}
export interface Indice { formato: number; gerado?: string; jogos: Entrada[] }

const URL_INDICE = process.env.CARTUCHO_CONQUISTAS_URL || 'https://raw.githubusercontent.com/GabrielGoris/cartucho/dados/conquistas.json';
let atual: Indice = EMBUTIDO as Indice;
let porRepo = new Map<string, Entrada>();
const norm = (r: string) => r.trim().toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
function montar() { porRepo = new Map(atual.jogos.flatMap(e => e.repos.map(r => [norm(r), e] as [string, Entrada]))); }
montar();

export function validar(v: unknown): Indice | null {
  const o = v as Indice;
  if (!o || typeof o !== 'object' || o.formato !== 1 || !Array.isArray(o.jogos)) return null;
  return { formato: 1, gerado: o.gerado, jogos: o.jogos.filter(e => e && Array.isArray(e.repos) && e.repos.every(r => typeof r === 'string')) };
}
export function usarIndice(i: Indice) { atual = i; montar(); }
export const indice = () => atual;
export const entradaDo = (repo: string | null | undefined) => (repo ? porRepo.get(norm(repo)) ?? null : null);
/** Baixa o índice mais novo (sem travar se a internet falhar: fica o que já tinha). */
export async function atualizarIndice(): Promise<Indice | null> {
  const v = validar(await getJson<unknown>(URL_INDICE).catch(() => null));
  if (v && v.jogos.length) usarIndice(v);
  return v;
}

function pastas(ctx: AdapterContext): Record<string, string> {
  const win = process.platform === 'win32';
  const user = win ? homedir() : join(ctx.appData, '..', '..');
  return {
    jogo: ctx.installDir, appdata: ctx.appData, localappdata: join(ctx.appData, '..', 'Local'), usuario: user,
    documentos: join(user, 'Documents'), jogos_salvos: join(user, 'Saved Games'),
    publico: win ? join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents') : join(ctx.appData, '..', '..', '..', 'Public', 'Documents'),
  };
}
export function expandir(caminho: string, ctx: AdapterContext, id?: string) {
  const p = pastas(ctx);
  return caminho.replace(/\{(\w+)\}/g, (m, k: string) => (k === 'id' && id != null ? id : p[k] ?? m)).replace(/[\\/]+/g, sep);
}
/** Troca os {marcadores} e resolve * (um trecho de pasta ou arquivo); devolve os que existem, o mais novo primeiro. */
export function resolver(caminho: string, ctx: AdapterContext, id?: string): string[] {
  const s = expandir(caminho, ctx, id);
  let atuais = [s.startsWith(sep) ? sep : ''];
  const partes = s.split(sep).filter(Boolean);
  if (/^[a-z]:$/i.test(partes[0] ?? '')) atuais = [partes.shift()! + sep];
  for (const parte of partes) {
    const prox: string[] = [];
    for (const base of atuais) {
      if (!parte.includes('*')) { prox.push(join(base, parte)); continue; }
      const re = new RegExp(`^${parte.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
      try { for (const n of readdirSync(base || '.')) if (re.test(n)) prox.push(join(base, n)); } catch { }
    }
    atuais = prox.slice(0, 50);
  }
  return atuais.flatMap(f => { try { return [[f, statSync(f).mtimeMs] as [string, number]]; } catch { return []; } }).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

export function lerDesbloqueios(buf: Uint8Array, formato: Formato | undefined, arquivo: string): Unlock[] {
  switch (formato) {
    case 'hedge': return readHedgeAch(buf);
    case 'goldberg': case 'ini': case 'tenoke': return readEmuUnlocks(buf);
    case 'earned': return readEarnedTsv(buf);
    case 'binario': return [];
    default: return readRecompFile(buf, arquivo);
  }
}

const ctxRepo = (ctx: AdapterContext) => entradaDo(ctx.repo);
function arquivosDeDesbloqueio(ctx: AdapterContext): { arquivo: string; formato?: Formato }[] {
  const e = ctxRepo(ctx); if (!e) return [];
  const out: { arquivo: string; formato?: Formato }[] = [];
  for (const f of e.desbloqueios ?? []) if (f.caminho) for (const a of resolver(f.caminho, ctx)) out.push({ arquivo: a, formato: f.formato });
  if (e.procurar?.length) {
    const want = new Set(e.procurar.map(n => n.toLowerCase()));
    for (const a of recompFiles(ctx, want)) if (!out.some(o => o.arquivo === a)) out.push({ arquivo: a });
  }
  return out;
}

export const indiceAdapter: Adapter = {
  id: 'indice',
  label: tt('Conquistas do recomp (índice do Cosmo)'),
  repos: [],
  // Só é escolhido pelo repositório (ver service.detectAdapters); pela pasta, quem cuida é o leitor genérico.
  detect: () => false,
  refreshDefs: true,
  async definitions(ctx): Promise<Definitions> {
    const e = ctxRepo(ctx);
    if (e?.conquistas?.length) {
      const urls = new Map(e.conquistas.flatMap(a => (a.icone && /^https:/.test(a.icone) ? [[idOf(a.id)!, a.icone] as [number, string]] : [])));
      return { list: e.conquistas.map(a => ({ id: idOf(a.id)!, name: a.nome, description: a.desc ?? '', points: null })), images: await fetchImages(urls), origin: tt('índice de conquistas do Cosmo') };
    }
    for (const f of e?.lista ?? []) {
      let texto = '';
      if (f.url) texto = await achNet.fetch?.(f.url, { signal: AbortSignal.timeout(20_000) }).then(r => (r.ok ? r.text() : '')).catch(() => '') ?? '';
      else if (f.caminho) { const a = resolver(f.caminho, ctx)[0]; if (a) try { texto = readFileSync(a, 'utf8'); } catch { } }
      if (!texto) continue;
      const listas = f.formato === 'tenoke' ? [parseTenoke(texto).map(a => ({ key: a.api, name: a.name, desc: a.desc }))] : extractDefs(texto, f.caminho ?? f.url ?? '');
      const melhor = listas.sort((a, b) => b.length - a.length)[0];
      if (!melhor?.length) continue;
      const keys = melhor.map(d => d.key);
      const icons = e?.icones ? new Map(keys.flatMap(k => { const a = resolver(e.icones!, ctx, k)[0]; try { return a ? [[k, new Uint8Array(readFileSync(a))] as [string, Uint8Array]] : []; } catch { return []; } })) : findIcons(keys, recompRoots(ctx));
      const images = new Map([...icons].map(([k, b]) => [idOf(k)!, b] as [number, Uint8Array]));
      return { list: melhor.map(d => ({ id: idOf(d.key)!, name: d.name, description: d.desc, points: null })), images, origin: tt('índice de conquistas do Cosmo') };
    }
    // Sem lista no índice: a descoberta genérica, olhando também os nomes que o índice mandou procurar.
    const wanted = new Set<number>();
    for (const u of todosDesbloqueios(ctx)) wanted.add(u.id);
    const achou = discoverList(recompRoots(ctx), wanted, k => idOf(k));
    if (!achou) return { list: [], origin: tt('índice de conquistas do Cosmo') };
    const images = new Map([...achou.icons].map(([k, b]) => [idOf(k)!, b] as [number, Uint8Array]));
    return { list: achou.defs.map(d => ({ id: idOf(d.key)!, name: d.name, description: d.desc, points: null })), images, origin: tt('lista encontrada em {0}', { 0: achou.file.split(/[\\/]/).slice(-2).join('/') }) };
  },
  unlockFile: ctx => arquivosDeDesbloqueio(ctx)[0]?.arquivo ?? '',
  // Observa também os caminhos fixos que ainda não existem (o arquivo aparece no primeiro desbloqueio).
  watchFiles: ctx => [...new Set([...arquivosDeDesbloqueio(ctx).map(a => a.arquivo), ...(ctxRepo(ctx)?.desbloqueios ?? []).flatMap(f => (f.caminho && !f.caminho.includes('*') ? [expandir(f.caminho, ctx)] : []))])],
  readUnlocks(buf, ctx) {
    const a = arquivosDeDesbloqueio(ctx)[0];
    return a ? lerDesbloqueios(buf, a.formato, a.arquivo) : [];
  },
};
/** Junta os desbloqueios de todos os arquivos que o índice aponta (para escolher a lista que mais casa). */
function todosDesbloqueios(ctx: AdapterContext): Unlock[] {
  const out = new Map<number, Unlock>();
  for (const a of arquivosDeDesbloqueio(ctx)) {
    try { for (const u of lerDesbloqueios(new Uint8Array(readFileSync(a.arquivo)), a.formato, a.arquivo)) if (!out.has(u.id)) out.set(u.id, u); } catch { }
  }
  return [...out.values()];
}
