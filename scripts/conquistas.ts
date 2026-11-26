/**
 * Gera o índice de conquistas dos recomps (conquistas.json, publicado no ramo `dados`).
 * Para cada projeto do catálogo de consoles que tinham conquistas ou troféus, baixa só o código-fonte e procura
 * os nomes dos arquivos de conquista que o próprio projeto grava. O Cosmo usa esses nomes para achar os
 * desbloqueios na pasta do jogo e na do usuário, sem leitor feito à mão. Entradas manuais (conquistas-manuais.json)
 * completam ou corrigem o que a varredura não descobre sozinha.
 *
 * uso: node --experimental-transform-types --import ./scripts/ts.mjs scripts/conquistas.ts <saída.json> [--clones <pasta>]
 *   --clones: usa repositórios já baixados (pastas dono__repo) em vez de baixar de novo.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CATALOG = process.env.CARTUCHO_CATALOG_URL || 'https://recompendium.com/unricopie/catalogo.json';
const CONSOLES = new Set(['x360', 'xbox', 'xboxone', 'ps3', 'ps4', 'ps5', 'vita', 'switch', 'switch2', 'wiiu', '3ds', 'pc']);
const SRC = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inl|rs|cs|go|zig|py|ts|js)$/i;
const SKIP_DIR = /^(\.git|third_?party|thirdparty|external|vendor|deps|extern|node_modules|tests?|docs?|imgui|xenia|rpcs3|shadps4|ryujinx|yuzu|sdl\d*|vulkan|glslang|spirv.*|zstd|zlib|fmt|json)$/i;
const FILE_RE = /["'`]([\w .-]{0,60}(?:achiev|troph|cheev|earned)[\w .-]{0,40}\.(?:txt|jsonl|json|ini|tsv|csv|dat|bin|html|toml))["'`]/gi;
const DEFS = /name|text|list|catalog|def|desc|schema|lang|conf|key|iv\b|toast|ui|icon|image|png/i;

export interface Achado { procurar: string[]; listas: string[]; binarios: string[] }

/** Lê o código de um repositório baixado e devolve os nomes de arquivo de conquista que ele grava. */
export function varrer(dir: string): Achado {
  const unlock = new Set<string>(), listas = new Set<string>(), bin = new Set<string>();
  const q = [dir];
  let n = 0;
  while (q.length && n < 6000) {
    const d = q.shift()!;
    let ents: import('node:fs').Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) q.push(p); continue; }
      if (!SRC.test(e.name)) continue;
      n++;
      let t = '';
      try { if (statSync(p).size > 3_000_000) continue; t = readFileSync(p, 'utf8'); } catch { continue; }
      if (/#define\s+ACH_FILENAME\s+"ACH-DATA"/.test(t)) unlock.add('ach-data');
      for (const m of t.matchAll(FILE_RE)) {
        const name = m[1]!.trim().split(/[\\/]/).pop()!.toLowerCase();
        if (!name || name.includes(' ') && name.length > 40) continue;
        if (/\.(dat|bin)$/.test(name)) bin.add(name);
        else if (DEFS.test(name) || /\.html?$/.test(name)) listas.add(name);
        else unlock.add(name);
      }
    }
  }
  return { procurar: [...unlock].sort(), listas: [...listas].sort(), binarios: [...bin].sort() };
}

async function baixar(repo: string, into: string) {
  await run('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', `https://github.com/${repo}`, into], { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  await run('git', ['-C', into, 'sparse-checkout', 'set', '--no-cone', ...['*.c', '*.cc', '*.cpp', '*.h', '*.hpp', '*.inl', '*.rs', '*.cs', '*.go'].map(x => x)], { timeout: 180_000 });
}

async function main() {
  const [out, ...rest] = process.argv.slice(2);
  if (!out) throw new Error('uso: conquistas.ts <saída.json> [--clones <pasta>]');
  const clones = rest[rest.indexOf('--clones') + 1] && rest.includes('--clones') ? rest[rest.indexOf('--clones') + 1]! : null;
  const cat = await (await fetch(CATALOG, { signal: AbortSignal.timeout(60_000) })).json() as { entradas: { repo?: string; consola?: string }[] };
  const repos = [...new Set(cat.entradas.filter(e => e.repo && CONSOLES.has(e.consola ?? '')).map(e => e.repo!))].sort();
  const tmp = clones ?? mkdtempSync(join(tmpdir(), 'conquistas-'));
  const jogos: { repos: string[]; procurar?: string[]; nota?: string }[] = [];
  let i = 0, falhas = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let k = i++; k < repos.length; k = i++) {
      const repo = repos[k]!, dir = join(tmp, repo.replace('/', '__'));
      try { if (!existsSync(dir)) { if (clones) continue; await baixar(repo, dir); } } catch { falhas++; continue; }
      const a = varrer(dir);
      if (!clones) rmSync(dir, { recursive: true, force: true });
      if (a.procurar.length) jogos.push({ repos: [repo], procurar: a.procurar });
      else if (a.binarios.length) jogos.push({ repos: [repo], nota: `formato binário: ${a.binarios.join(', ')}` });
    }
  }));
  const manual = JSON.parse(readFileSync(new URL('./conquistas-manuais.json', import.meta.url), 'utf8')) as { jogos: { repos: string[] }[] };
  for (const m of manual.jogos) {
    const j = jogos.findIndex(x => x.repos.some(r => m.repos.map(y => y.toLowerCase()).includes(r.toLowerCase())));
    if (j >= 0) jogos[j] = { ...jogos[j], ...m }; else jogos.push(m);
  }
  jogos.sort((a, b) => a.repos[0]!.localeCompare(b.repos[0]!));
  writeFileSync(out, JSON.stringify({ formato: 1, gerado: new Date().toISOString(), jogos }, null, 1) + '\n');
  console.log(`${repos.length} projetos, ${jogos.length} no índice, ${falhas} não baixaram`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('conquistas.ts')) await main();
