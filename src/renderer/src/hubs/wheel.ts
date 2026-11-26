import type { WheelEvent } from 'react';
import { sendKey } from '../lib/input';

let at = 0;
/**
 * Rodinha do mouse nas bibliotecas dos consoles: vira as setas, então anda como o controle e a tela acompanha.
 * `v`: a rodinha sobe e desce pelas fileiras; `h`: anda para os lados (fileiras e fitas horizontais).
 * Trackpad de lado (ou Shift + rodinha) anda para os lados nos dois casos.
 */
export const wheelNav = (axis: 'v' | 'h') => (e: WheelEvent) => {
  const side = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const d = Math.sign(side ? e.deltaX || e.deltaY : e.deltaY), now = performance.now();
  if (!d || now - at < 90) return;
  at = now;
  sendKey(side || axis === 'h' ? (d > 0 ? 'ArrowRight' : 'ArrowLeft') : d > 0 ? 'ArrowDown' : 'ArrowUp');
};
