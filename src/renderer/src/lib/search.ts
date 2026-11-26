const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchesQuery(q: string, ...fields: (string | null | undefined)[]) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ' ' + fields.filter(Boolean).map(f => norm(f!)).join(' ') + ' ';
  const squashed = hay.replace(/ /g, '');
  return words.every(w => hay.includes(' ' + w) || hay.includes(w) || squashed.includes(w));
}

export const focusSearch = () => {
  const el = [...document.querySelectorAll<HTMLInputElement>('input[data-search]')].find(e => e.offsetParent);
  if (!el) return false;
  el.focus(); el.select();
  return true;
};

function grams(s: string) { const t = ` ${norm(s)} `, g = new Set<string>(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
export function similarity(a: string, b: string) {
  const A = grams(a), B = grams(b); let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size || 1);
}
