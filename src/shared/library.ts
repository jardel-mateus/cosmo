/** Jogados recentemente: até RECENT_MAX jogos, os jogados nos últimos RECENT_DAYS dias (ou abertos agora). */
export const RECENT_MAX = 6;
export const RECENT_DAYS = 60;

type G = { title: string; installed: { lastPlayed: number | null; running?: boolean; missing: boolean } | null };

/**
 * Ordem da biblioteca de um console: primeiro os jogados recentemente (do mais recente para o mais antigo),
 * depois a coleção em ordem alfabética, com os desinstalados no fim. `recent` diz quantos dos primeiros são recentes.
 */
export function orderLibrary<T extends G>(games: readonly T[], now = Date.now()): { list: T[]; recent: number } {
  const since = now - RECENT_DAYS * 86400_000;
  const last = (g: T) => (g.installed?.running ? now : g.installed?.lastPlayed ?? 0);
  const recent = games
    .filter(g => g.installed && !g.installed.missing && (g.installed.running || (g.installed.lastPlayed ?? 0) >= since))
    .sort((a, b) => last(b) - last(a))
    .slice(0, RECENT_MAX);
  const got = new Set(recent);
  const rest = games.filter(g => !got.has(g)).sort((a, b) =>
    Number(!!a.installed?.missing) - Number(!!b.installed?.missing) || a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base', numeric: true }));
  return { list: [...recent, ...rest], recent: recent.length };
}

/**
 * Passo pelo controle numa grade com duas partes (jogados recentemente e coleção), cada uma começando numa linha nova.
 * `split` é quantos itens tem a primeira parte. Devolve o novo índice, 'top' ao subir da primeira linha, ou null se não anda.
 */
export function gridStep(i: number, n: number, cols: number, split: number, dir: 'L' | 'R' | 'U' | 'D'): number | 'top' | null {
  if (n <= 0) return dir === 'U' ? 'top' : null;
  const b2 = split > 0 && i >= split, base = b2 ? split : 0, end = b2 || split <= 0 ? n : split;
  const j = i - base, r = Math.floor(j / cols), c = j % cols, last = Math.floor((end - base - 1) / cols);
  if (dir === 'R') return c < cols - 1 && i + 1 < end ? i + 1 : null;
  if (dir === 'L') return c > 0 ? i - 1 : null;
  if (dir === 'D') {
    if (i + cols < end) return i + cols;
    if (r < last) return end - 1;
    if (!b2 && split > 0 && n > split) return split + Math.min(c, n - split - 1);
    return null;
  }
  if (r > 0) return i - cols;
  if (b2 && split > 0) { const start = Math.floor((split - 1) / cols) * cols; return start + Math.min(c, split - 1 - start); }
  return 'top';
}
