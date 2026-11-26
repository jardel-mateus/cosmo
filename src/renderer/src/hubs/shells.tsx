import type { ReactNode } from 'react';

export type Kind = 'n64' | 'snes' | 'nes' | 'md' | 'gb' | 'nds' | 'mc1' | 'mc2' | 'gc' | 'box';

interface Shell { vb: [number, number]; lbl: [number, number, number, number]; r: number; size: number; cols: number; back: ReactNode; front?: ReactNode }

const grad = (id: string, a: string, b: string, dir: 'v' | 'h' = 'v') => (
  <linearGradient id={id} x1="0" y1="0" x2={dir === 'h' ? '1' : '0'} y2={dir === 'v' ? '1' : '0'}><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
);
const lines = (n: number, x1: number, x2: number, y: number, gap: number, dark: string, light: string, w = 2) => Array.from({ length: n }, (_, i) => (
  <g key={i}><line x1={x1} x2={x2} y1={y + i * gap} y2={y + i * gap} stroke={dark} strokeWidth={w} /><line x1={x1} x2={x2} y1={y + i * gap + w} y2={y + i * gap + w} stroke={light} strokeWidth={1} /></g>
));
const vlines = (n: number, x: number, gap: number, y1: number, y2: number, dark: string, light: string, w = 3) => Array.from({ length: n }, (_, i) => (
  <g key={i}><line x1={x + i * gap} x2={x + i * gap} y1={y1} y2={y2} stroke={dark} strokeWidth={w} /><line x1={x + i * gap + w} x2={x + i * gap + w} y1={y1} y2={y2} stroke={light} strokeWidth={1} /></g>
));
const well = (x: number, y: number, w: number, h: number, r: number, c: string) => <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={r + 2} fill={c} />;
const sheen = (id: string, x: number, y: number, w: number, h: number) => (
  <>
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".38" stopColor="#fff" stopOpacity=".04" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity=".08" /></linearGradient></defs>
    <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`} />
  </>
);

export const SHELLS: Record<Kind, Shell> = {
  n64: {
    vb: [300, 290], lbl: [28, 30, 244, 172], r: 3, size: 330, cols: 4,
    back: <>
      <defs>{grad('sh-n64', '#a9a9ad', '#77777c')}</defs>
      <path d="M14,0 H286 Q300,0 300,14 V196 L288,206 V290 H12 V206 L0,196 V14 Q0,0 14,0 Z" fill="url(#sh-n64)" />
      <path d="M14,1.5 H286 Q298.5,1.5 298.5,14" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
      <rect x="10" y="6" width="280" height="14" rx="4" fill="#000" opacity=".1" />
      {well(28, 30, 244, 172, 3, '#5d5d62')}
      {lines(6, 30, 270, 224, 10, '#6a6a70', '#b9b9bd')}
      <path d="M12,206 L0,196 M288,206 L300,196" stroke="#5c5c61" strokeWidth="2" />
    </>,
  },
  snes: {
    vb: [300, 216], lbl: [44, 48, 212, 150], r: 3, size: 360, cols: 4,
    back: <>
      <defs>{grad('sh-snes', '#d1d1d6', '#a5a5ad')}{grad('sh-snes-g', '#9b9ba4', '#c9c9cf')}</defs>
      <path d="M24,0 H276 Q300,0 300,24 V196 Q300,216 280,216 H252 V208 H48 V216 H20 Q0,216 0,196 V24 Q0,0 24,0 Z" fill="url(#sh-snes)" />
      <path d="M18,6 Q150,-2 282,6 L282,36 Q150,28 18,36 Z" fill="url(#sh-snes-g)" />
      {[12, 19, 26].map(y => <path key={y} d={`M24,${y} Q150,${y - 7} 276,${y}`} fill="none" stroke="#86868f" strokeWidth="2" />)}
      {well(44, 48, 212, 150, 3, '#8c8c95')}
      <rect x="14" y="52" width="16" height="142" rx="5" fill="#9a9aa3" /><rect x="270" y="52" width="16" height="142" rx="5" fill="#9a9aa3" />
      <rect x="17" y="55" width="10" height="136" rx="4" fill="#b8b8bf" /><rect x="273" y="55" width="10" height="136" rx="4" fill="#b8b8bf" />
    </>,
  },
  nes: {
    vb: [240, 264], lbl: [18, 18, 204, 170], r: 2, size: 290, cols: 4,
    back: <>
      <defs>{grad('sh-nes', '#a2a2a8', '#7c7c83')}</defs>
      <path d="M6,0 H234 Q240,0 240,6 V258 Q240,264 234,264 H6 Q0,264 0,258 V6 Q0,0 6,0 Z" fill="url(#sh-nes)" />
      <rect x="96" y="0" width="48" height="6" fill="#6c6c73" />
      {well(18, 18, 204, 170, 2, '#5f5f66')}
      {lines(8, 18, 222, 204, 7, '#66666d', '#b0b0b6', 3)}
    </>,
  },
  md: {
    vb: [250, 290], lbl: [22, 36, 206, 186], r: 2, size: 290, cols: 4,
    back: <>
      <defs>{grad('sh-md', '#2e2e33', '#0b0b0d')}</defs>
      <path d="M0,40 Q0,12 26,7 Q125,-7 224,7 Q250,12 250,40 V290 H0 Z" fill="url(#sh-md)" />
      <path d="M8,36 Q10,16 30,12 Q125,0 220,12 Q240,16 242,36" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="2" />
      {well(22, 36, 206, 186, 2, '#000')}
      {lines(6, 22, 228, 238, 8, '#000', '#3a3a40', 3)}
      <rect x="0" y="286" width="250" height="4" fill="#000" />
    </>,
  },
  gb: {
    vb: [230, 262], lbl: [22, 54, 186, 176], r: 6, size: 270, cols: 4,
    back: <>
      <defs>{grad('sh-gb', '#d3d3ce', '#acaca6')}</defs>
      <path d="M8,0 H188 L230,42 V252 Q230,262 220,262 H10 Q0,262 0,252 V8 Q0,0 8,0 Z" fill="url(#sh-gb)" />
      {lines(5, 16, 172, 12, 6, '#9b9b95', '#e2e2dd', 2)}
      <rect x="16" y="46" width="198" height="192" rx="10" fill="#bdbdb7" />
      {well(22, 54, 186, 176, 6, '#a3a39d')}
      <path d="M115,252 l-8,-8 h16 z" fill="#9b9b95" />
    </>,
  },
  nds: {
    vb: [200, 222], lbl: [14, 16, 172, 162], r: 4, size: 240, cols: 3,
    back: <>
      <defs>{grad('sh-nds', '#5a5d64', '#33353a')}</defs>
      <path d="M16,0 H192 Q200,0 200,8 V214 Q200,222 192,222 H8 Q0,222 0,214 V16 Z" fill="url(#sh-nds)" />
      {well(14, 16, 172, 162, 4, '#26282c')}
      {lines(3, 20, 180, 192, 8, '#26282c', '#6a6d74', 3)}
    </>,
  },
  mc1: {
    vb: [300, 286], lbl: [30, 8, 262, 270], r: 0, size: 320, cols: 4,
    back: <>
      <defs>{grad('sh-mc1', '#151517', '#060607', 'h')}</defs>
      <rect x="0" y="0" width="300" height="286" rx="3" fill="url(#sh-mc1)" />
      <rect x="2" y="2" width="22" height="282" fill="#0e0e10" />
      {[24, 64, 222, 262].map(y => <rect key={y} x="5" y={y - 14} width="16" height="22" rx="2" fill="#1f1f23" stroke="#2c2c31" />)}
    </>,
    front: <>{sheen('sf-mc1', 24, 0, 276, 286)}<rect x="24.5" y="0.5" width="275" height="285" fill="none" stroke="#fff" strokeOpacity=".18" /></>,
  },
  mc2: {
    vb: [260, 368], lbl: [20, 8, 232, 352], r: 0, size: 250, cols: 4,
    back: <>
      <rect x="0" y="0" width="260" height="368" rx="8" fill="#0c0c0e" />
      <rect x="0" y="0" width="16" height="368" rx="6" fill="#1a1a1e" />
      {vlines(3, 4, 4, 10, 358, '#0a0a0c', '#2a2a30', 1)}
    </>,
    front: <>{sheen('sf-mc2', 16, 0, 244, 368)}<rect x="16.5" y="0.5" width="243" height="367" rx="6" fill="none" stroke="#fff" strokeOpacity=".16" /></>,
  },
  gc: {
    vb: [250, 348], lbl: [18, 8, 224, 332], r: 0, size: 255, cols: 4,
    back: <>
      <rect x="0" y="0" width="250" height="348" rx="6" fill="#121214" />
      <rect x="0" y="0" width="14" height="348" rx="5" fill="#1d1d21" />
      {vlines(2, 4, 4, 10, 338, '#0b0b0d', '#2d2d33', 1)}
    </>,
    front: <>{sheen('sf-gc', 14, 0, 236, 348)}<rect x="14.5" y="0.5" width="235" height="347" rx="5" fill="none" stroke="#fff" strokeOpacity=".16" /></>,
  },
  box: {
    vb: [250, 350], lbl: [16, 6, 228, 338], r: 2, size: 260, cols: 4,
    back: <>
      <rect x="0" y="0" width="250" height="350" rx="6" fill="#141018" />
      <rect x="0" y="0" width="12" height="350" rx="5" fill="#231c2c" />
    </>,
    front: sheen('sf-box', 12, 0, 238, 350),
  },
};

export const shellH = (k: Kind) => { const s = SHELLS[k]; return Math.round(s.size * s.vb[1] / s.vb[0]); };

export function Obj({ kind, children }: { kind: Kind; children: ReactNode }) {
  const s = SHELLS[kind], [w, h] = s.vb, [x, y, lw, lh] = s.lbl;
  const pct = (v: number, t: number) => `${(v / t) * 100}%`;
  return (
    <span className="obj" style={{ width: s.size, height: shellH(kind) }}>
      <svg className="sh" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{s.back}</svg>
      <span className="lbl" style={{ left: pct(x, w), top: pct(y, h), width: pct(lw, w), height: pct(lh, h), borderRadius: s.r * (s.size / w) }}>{children}</span>
      {s.front && <svg className="sh fx" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{s.front}</svg>}
    </span>
  );
}
