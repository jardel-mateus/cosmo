/**
 * Navegação espacial (setas/controle) entre elementos marcados com data-hf dentro de um contêiner.
 * O foco é pintado com data-on (atributo que o React não controla, então não é apagado num re-render).
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { useKeys, type Key } from './input';
import { sfx } from './sfx';

interface Opts {
  active: boolean;
  /** Seletor do elemento que ganha o foco ao abrir (ex.: o botão principal). */
  initial?: string;
  onKey?: (k: Key) => boolean | void;          // devolve true se tratou a tecla antes da navegação
  onFocus?: (el: HTMLElement | null) => void;
}

export function useSpatialNav(root: RefObject<HTMLElement | null>, { active, initial, onKey, onFocus }: Opts) {
  const idx = useRef(-1);
  const els = useCallback(() => root.current ? [...root.current.querySelectorAll<HTMLElement>('[data-hf]')].filter(e => e.offsetParent) : [], [root]);

  const paint = useCallback(() => {
    const L = els();
    root.current?.querySelectorAll('[data-on]').forEach(e => e.removeAttribute('data-on'));
    if (!active || !L.length) { onFocus?.(null); return; }
    if (idx.current < 0 || idx.current >= L.length) {
      const i = initial ? L.findIndex(e => e.matches(initial)) : 0;
      idx.current = Math.max(0, i);
    }
    const el = L[idx.current]!;
    el.setAttribute('data-on', '');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    onFocus?.(el);
  }, [active, els, initial, onFocus, root]);

  useLayoutEffect(() => { paint(); });

  const focusEl = useCallback((el: HTMLElement) => { const i = els().indexOf(el); if (i >= 0) { idx.current = i; paint(); } }, [els, paint]);
  const reset = useCallback(() => { idx.current = -1; paint(); }, [paint]);

  useKeys(k => {
    if (onKey?.(k)) return;
    const L = els(); if (!L.length) return;
    if (idx.current < 0 || idx.current >= L.length) idx.current = 0;
    if (k === 'Enter') { L[idx.current]!.click(); return; }
    const dirs: Key[] = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!dirs.includes(k)) return;
    const a = L[idx.current]!.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = -1, bs = Infinity;
    L.forEach((e, j) => {
      if (j === idx.current) return;
      const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const ok = k === 'ArrowRight' ? dx > 10 : k === 'ArrowLeft' ? dx < -10 : k === 'ArrowDown' ? dy > 10 : dy < -10;
      if (!ok) return;
      const h = k === 'ArrowRight' || k === 'ArrowLeft';
      const sc = (h ? Math.abs(dx) : Math.abs(dy)) + (h ? Math.abs(dy) : Math.abs(dx)) * 2.2;
      if (sc < bs) { bs = sc; best = j; }
    });
    if (best >= 0) { idx.current = best; sfx.play('move'); paint(); }
  }, active);

  return { focusEl, reset, paint };
}
