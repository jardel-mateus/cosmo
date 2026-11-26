import type { MouseEvent } from 'react';

/** O que importa de um jogo da biblioteca para o clique (HubGame serve). */
type G = { installed: { missing: boolean } | null };

/** Jogo da biblioteca sem os arquivos (desinstalado ou pasta sumida): o A abre a página, onde ficam as opções. */
export const semArquivos = (g: G | null | undefined) => !!g?.installed?.missing;

let timer: ReturnType<typeof setTimeout> | undefined;
/**
 * Clique do mouse num jogo: um clique abre a página; num jogo instalado, dois cliques jogam.
 * (Desinstalado ou do catálogo abre a página na hora: não tem o que jogar.)
 */
export function tileClick(e: MouseEvent, g: G, a: { select: () => void; page: () => void; play: () => void }) {
  clearTimeout(timer);
  a.select();
  if (!g.installed || g.installed.missing) { a.page(); return; }
  if (e.detail >= 2) { a.play(); return; }
  timer = setTimeout(a.page, 240);
}
