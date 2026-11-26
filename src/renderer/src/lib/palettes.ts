import { tt } from '@shared/i18n';
export interface Palette {
  id: string; n: string; d: string; light?: boolean;
  bg0: string; bg: string; bg2: string; panel: string; line: string; ink: string; dim: string;
  acc: string; acc2: string; onAcc: string; pink: string; onPink: string; cyan: string; onCyan: string;
}

export const PALETTES: Palette[] = [
  { id: 'cosmo', n: tt('Cosmo'), d: tt('Azul de espaço profundo, verde-água e laranja-sol. A padrão.'), bg0: '#05070f', bg: '#0a0f1f', bg2: '#0d1428', panel: '#131c36', line: '#24325a', ink: '#eaf1ff', dim: '#8b9cc4', acc: '#36e2c4', acc2: '#7af0db', onAcc: '#002a22', pink: '#ffb347', onPink: '#2a1600', cyan: '#a594ff', onCyan: '#120a3a' },
  { id: 'aurora', n: tt('Aurora'), d: tt('Céu polar: verde-limão, rosa e azul-gelo sobre quase preto.'), bg0: '#030807', bg: '#08120f', bg2: '#0b1814', panel: '#10221c', line: '#1f3d33', ink: '#e9fff6', dim: '#86b3a3', acc: '#7dff9e', acc2: '#b0ffc4', onAcc: '#00260d', pink: '#ff7ad9', onPink: '#2a0020', cyan: '#7cc8ff', onCyan: '#001a2e' },
  { id: 'nebulosa', n: tt('Nebulosa'), d: tt('Vinho escuro, rosa-choque e dourado.'), bg0: '#0a0309', bg: '#160812', bg2: '#1c0b17', panel: '#281020', line: '#4a1f3c', ink: '#ffeef8', dim: '#c08fb0', acc: '#ff5fa2', acc2: '#ff96c2', onAcc: '#2a0014', pink: '#ffd166', onPink: '#2a1f00', cyan: '#8be9fd', onCyan: '#00222a' },
  { id: 'neon', n: tt('Neon de shopping'), d: tt('Roxo profundo, magenta e ciano.'), bg0: '#07020f', bg: '#120624', bg2: '#170a2c', panel: '#1f0f3a', line: '#3b2266', ink: '#f6eaff', dim: '#a58cc8', acc: '#ff3ea5', acc2: '#ff7cc4', onAcc: '#2a0016', pink: '#34e3ff', onPink: '#00222a', cyan: '#b6ff5c', onCyan: '#142a00' },
  { id: 'fliperama', n: tt('Fliperama'), d: tt('Âmbar de fósforo sobre roxo-noite. A original.'), bg0: '#050409', bg: '#0d0b16', bg2: '#0f0c1c', panel: '#17132a', line: '#2e2748', ink: '#f2e9d8', dim: '#8d84ab', acc: '#ffb43d', acc2: '#ffd07a', onAcc: '#2a1700', pink: '#ff4f8b', onPink: '#22000d', cyan: '#4fe3d2', onCyan: '#00211d' },
  { id: 'vhs', n: tt('Fita VHS'), d: tt('Etiqueta de fita: azul-marinho, coral e amarelo.'), bg0: '#04070f', bg: '#0a1226', bg2: '#0d1730', panel: '#13203f', line: '#26365e', ink: '#f4ead8', dim: '#8b9ac0', acc: '#ff6a4d', acc2: '#ff9a83', onAcc: '#2a0700', pink: '#ffd23f', onPink: '#2a2000', cyan: '#3fd0c9', onCyan: '#002220' },
  { id: 'lava', n: tt('Brasa'), d: tt('Marrom quase preto, laranja e dourado.'), bg0: '#080403', bg: '#150b08', bg2: '#1b0f0b', panel: '#251510', line: '#48291d', ink: '#f6e3cf', dim: '#b08e78', acc: '#ff7a2f', acc2: '#ffa36b', onAcc: '#2a0e00', pink: '#ffd23f', onPink: '#2a2000', cyan: '#ff5b6b', onCyan: '#2a0006' },
  { id: 'gelo', n: tt('Madrugada'), d: tt('Azul de madrugada, gelo e rosa.'), bg0: '#050b12', bg: '#0b1622', bg2: '#0e1b2a', panel: '#142538', line: '#27405c', ink: '#e8f1f8', dim: '#8aa3bd', acc: '#8fd3ff', acc2: '#bfe6ff', onAcc: '#04202e', pink: '#ff8fb1', onPink: '#2a0010', cyan: '#9effc9', onCyan: '#00220f' },
  { id: 'bolso', n: tt('Tela de bolso'), d: tt('Verde-oliva de portátil antigo com laranja.'), bg0: '#0b1008', bg: '#151d10', bg2: '#19220f', panel: '#222d18', line: '#3a4a28', ink: '#e4eecb', dim: '#93a37a', acc: '#c2d84f', acc2: '#d8e98a', onAcc: '#1a2400', pink: '#f0a83a', onPink: '#2a1600', cyan: '#7fd0b0', onCyan: '#082018' },
  { id: 'plastico', n: tt('Plástico cinza'), d: tt('Console claro dos anos 90: cinza, vermelho e azul.'), light: true, bg0: '#a9a59c', bg: '#d8d4cb', bg2: '#ebe8e1', panel: '#f3f0ea', line: '#bdb8ad', ink: '#26232b', dim: '#6d6876', acc: '#d6403a', acc2: '#e86a64', onAcc: '#ffffff', pink: '#2f4fa8', onPink: '#ffffff', cyan: '#2f8a5a', onCyan: '#ffffff' },
];

export const paletteById = (id: string) => PALETTES.find(p => p.id === id) ?? PALETTES[0]!;

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(' ');

export function applyPalette(p: Palette) {
  const r = document.documentElement.style;
  const map: Record<string, string> = {
    '--bg0': p.bg0, '--bg': p.bg, '--bg2': p.bg2, '--panel': p.panel, '--line': p.line, '--ink': p.ink, '--dim': p.dim,
    '--acc': p.acc, '--acc2': p.acc2, '--on-acc': p.onAcc, '--pink': p.pink, '--on-pink': p.onPink, '--cyan': p.cyan, '--on-cyan': p.onCyan,
    '--bg-rgb': rgb(p.bg), '--panel-rgb': rgb(p.panel), '--acc-rgb': rgb(p.acc), '--pink-rgb': rgb(p.pink), '--cyan-rgb': rgb(p.cyan),
  };
  for (const k in map) r.setProperty(k, map[k]!);
  document.body.classList.toggle('pal-light', !!p.light);
}
