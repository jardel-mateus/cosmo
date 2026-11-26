import { extname, isAbsolute, parse, relative, resolve } from 'node:path';
import { steamManifest } from './steam';
import { tt } from '@shared/i18n';

/**
 * Como desinstalar um jogo da biblioteca:
 * - managed: o Cosmo baixou, então apaga só os arquivos que vieram no download (saves ficam);
 * - steam: pede para a Steam desinstalar (ela confirma do jeito dela);
 * - folder: a pasta do jogo vai para a Lixeira;
 * - file: o jogo é um arquivo só (uma ROM numa pasta com outras), então só ele vai para a Lixeira;
 * - blocked: apagar ia levar coisa demais junto.
 */
export type UninstallPlan =
  | { kind: 'managed' }
  | { kind: 'steam'; appid: string }
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'blocked'; reason: string };

interface G { id: string; installDir: string; exe: string | null; managed: boolean }

const PROGRAM = /^(\.exe|\.bat|\.cmd|\.lnk|\.sh|\.appimage|\.x86_64|\.x86|\.bin|)$/i;
const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '');
const same = (a: string, b: string) => (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase());
/** `child` é `parent` ou está dentro dele. */
export function within(child: string, parent: string) {
  const c = norm(child), p = norm(parent);
  if (same(c, p)) return true;
  const r = relative(process.platform === 'linux' ? p : p.toLowerCase(), process.platform === 'linux' ? c : c.toLowerCase());
  return !!r && !r.startsWith('..') && !isAbsolute(r);
}

export function planUninstall(g: G, others: G[], protect: string[]): UninstallPlan {
  if (g.managed) return { kind: 'managed' };
  const st = steamManifest(g.installDir, g.exe);
  if (st) return { kind: 'steam', appid: st.appid };

  if (g.exe && !PROGRAM.test(extname(g.exe)) && within(g.exe, g.installDir)) {
    const shared = others.some(o => o.id !== g.id && o.exe && same(norm(o.exe), norm(g.exe!)));
    if (shared) return { kind: 'blocked', reason: tt('Outro jogo da biblioteca usa o mesmo arquivo.') };
    return { kind: 'file', path: norm(g.exe) };
  }

  const dir = norm(g.installDir);
  const depth = relative(parse(dir).root, dir).split(/[\\/]/).filter(Boolean).length;
  if (depth < 2) return { kind: 'blocked', reason: tt('A pasta {0} é ampla demais para o Cosmo apagar. Apague os arquivos você mesmo.', { 0: dir }) };
  const hit = protect.find(p => p && within(p, dir));
  if (hit) return { kind: 'blocked', reason: tt('A pasta {0} tem {1} dentro dela. Apague os arquivos do jogo você mesmo.', { 0: dir, 1: norm(hit) }) };
  const other = others.find(o => o.id !== g.id && (within(o.installDir, dir) || within(dir, o.installDir)));
  if (other) return { kind: 'blocked', reason: tt('Outro jogo da biblioteca está na mesma pasta ({0}). Apague os arquivos você mesmo.', { 0: dir }) };
  return { kind: 'folder', path: dir };
}
