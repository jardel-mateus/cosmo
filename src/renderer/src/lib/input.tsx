import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSettings, useSettings } from './settings';

import { keyMapFor as mapFor, type Key, type PadMap } from '@shared/padmap';
import { tt } from '@shared/i18n';
export { padUsbId, type Key } from '@shared/padmap';
type Handler = (k: Key) => void;

const stack: { current: Handler }[] = [];
export function useKeys(fn: Handler, active = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { get current() { return ref.current; } };
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
}
let global: ((k: Key) => boolean) | null = null;
export const setGlobalKeys = (fn: (k: Key) => boolean) => { global = fn; };
export const sendKey = (k: Key) => { if (global?.(k)) return; stack.at(-1)?.current(k); };
const send = sendKey;
let last: 'pad' | 'kb' = 'kb';
const lastSubs = new Set<() => void>();
const setLast = (v: 'pad' | 'kb') => { if (last !== v) { last = v; lastSubs.forEach(f => f()); } };
export const lastInput = () => last;
export const useLastInput = () => useSyncExternalStore(f => { lastSubs.add(f); return () => lastSubs.delete(f); }, lastInput);

// Teclas fixas: navegam e voltam para o palco, não dá para trocar.
const FIXED_KEYS: Record<string, Key> = { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Tab: 'Tab', Home: 'Home' };
// Atalhos do Cosmo (S, M, C, P, /) e teclas do sistema também ficam de fora da troca.
const RESERVED_KEYS = new Set(['s', 'm', 'c', 'p', '/', 'F11', 'F12', 'PrintScreen', 'Alt', 'Meta', 'OS', 'Dead', 'Unidentified', 'Process', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu']);
export const KB_ACTIONS: Key[] = ['Enter', 'Escape', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start'];
export const KB_DEFAULT: Partial<Record<Key, string[]>> = {
  Enter: ['Enter', ' '], Escape: ['Escape', 'Backspace'], X: ['x'], Y: ['y'], LB: ['q'], RB: ['e'], LT: ['PageUp'], RT: ['PageDown'], Start: ['F1'], Select: ['F2'],
};
const KB_STORE = 'cartucho.kbmap';
const kbNorm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);
let kbMap: Partial<Record<Key, string[]>> = (() => {
  try { const v = JSON.parse(localStorage.getItem(KB_STORE) || 'null') as Partial<Record<Key, string[]>> | null; return v && typeof v === 'object' ? v : { ...KB_DEFAULT }; } catch { return { ...KB_DEFAULT }; }
})();
let kbVer = 0;
const kbSubs = new Set<() => void>();
const kbSave = (m: Partial<Record<Key, string[]>> | null) => {
  kbMap = m ?? { ...KB_DEFAULT }; kbVer++;
  try { if (m) localStorage.setItem(KB_STORE, JSON.stringify(m)); else localStorage.removeItem(KB_STORE); } catch { }
  kbSubs.forEach(f => f());
};
export const useKbMap = () => { useSyncExternalStore(f => { kbSubs.add(f); return () => kbSubs.delete(f); }, () => kbVer); return kbMap; };
export const kbKeysOf = (k: Key): string[] => kbMap[k] ?? [];
const kbAction = (key: string): Key | null => FIXED_KEYS[key] ?? (KB_ACTIONS.find(a => kbMap[a]?.includes(kbNorm(key))) ?? null);
export function keyLabel(key: string): string {
  const L: Record<string, string> = { ' ': tt('Espaço'), Escape: 'Esc', Backspace: '⌫', PageUp: 'PgUp', PageDown: 'PgDn', Control: 'Ctrl', Delete: 'Del', Insert: 'Ins', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: tt('Enter') };
  return L[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
/** Troca a tecla de uma ação. Se outra ação já usava a tecla, as duas trocam de lugar. Devolve um erro para mostrar, ou null. */
export function rebindKey(k: Key, raw: string): string | null {
  if (FIXED_KEYS[raw]) return tt('As setas, Tab e Home são fixas.');
  if (raw === 'PrintScreen') return tt('Print Screen é a tecla fixa de captura durante o jogo.');
  const key = kbNorm(raw);
  if (RESERVED_KEYS.has(key)) return key.length === 1 ? tt('{0} já é um atalho do Cosmo.', { 0: keyLabel(key) }) : tt('Essa tecla não pode ser usada.');
  const m: Partial<Record<Key, string[]>> = {};
  for (const a of KB_ACTIONS) m[a] = [...(kbMap[a] ?? [])];
  const old = m[k] ?? [];
  if (old[0] === key && old.length === 1) return null;
  for (const a of KB_ACTIONS) {
    if (a === k || !m[a]!.includes(key)) continue;
    const give = old[0] && old[0] !== key && !m[a]!.includes(old[0]) ? old[0] : null;
    m[a] = m[a]!.flatMap(x => (x !== key ? [x] : give ? [give] : []));
  }
  m[k] = [key];
  kbSave(m);
  return null;
}
export const resetKbMap = () => kbSave(null);

let kbRec: { label: string; k: Key } | null = null, kbRecDone: ((key: string | null) => void) | null = null, kbRecTimer = 0;
const kbRecSubs = new Set<() => void>();
export const useKeyRec = () => useSyncExternalStore(f => { kbRecSubs.add(f); return () => kbRecSubs.delete(f); }, () => kbRec);
function endKeyRec(key: string | null) { const f = kbRecDone; kbRec = null; kbRecDone = null; clearTimeout(kbRecTimer); kbRecSubs.forEach(x => x()); f?.(key); }
/** Espera a próxima tecla do teclado (Esc cancela, a não ser que a ação seja o próprio Voltar). */
export function recordKey(label: string, k: Key): Promise<string | null> {
  if (kbRec) endKeyRec(null);
  kbRec = { label, k }; kbRecSubs.forEach(x => x());
  kbRecTimer = window.setTimeout(() => endKeyRec(null), 12_000);
  return new Promise(r => { kbRecDone = r; });
}
export const cancelKeyRec = () => { if (kbRec) endKeyRec(null); };
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

let shortcut: ((key: string) => boolean) | null = null;
export const setShortcutHandler = (fn: (key: string) => boolean) => { shortcut = fn; };

// O que aparece nos botões da tela segue o que a pessoa usou por último: teclado ou controle (o mouse não muda).
let hand: 'pad' | 'kb' = 'kb';
const setHand = (v: 'pad' | 'kb') => { if (hand !== v) { hand = v; padSubs.forEach(f => f()); } };

if (typeof window !== 'undefined') {
  addEventListener('keydown', e => {
    if (!kbRec) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.key === 'Escape' && kbRec.k !== 'Escape') return endKeyRec(null);
    if (FIXED_KEYS[e.key] && e.key !== 'Tab') return;
    endKeyRec(e.key);
  }, true);
  addEventListener('mousemove', () => setLast('kb'), { passive: true });
  addEventListener('keydown', e => {
    setLast('kb'); setHand('kb');
    if (e.key === 'F11' || (e.altKey && e.key === 'Enter')) { e.preventDefault(); return; }
    if (e.repeat && (e.key === 'Enter' || e.key === 'Escape')) return;
    if (isTyping(e.target)) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && shortcut?.(e.key)) { e.preventDefault(); return; }
    const k = kbAction(e.key); if (!k) return;
    e.preventDefault();
    send(k);
  });
  addEventListener('click', e => { const b = (e.target as HTMLElement).closest?.('button'); if (b) b.blur(); }, true);
}

export type PadKind = 'kb' | 'xbox' | 'ps' | 'nin';
let connected: Gamepad | null = null;
const padSubs = new Set<() => void>();
const refreshPads = () => { connected = [...(navigator.getGamepads?.() ?? [])].find(Boolean) ?? null; padSubs.forEach(f => f()); };
if (typeof window !== 'undefined') { addEventListener('gamepadconnected', refreshPads); addEventListener('gamepaddisconnected', refreshPads); }

function detectKind(): PadKind {
  if (!connected || hand === 'kb') return 'kb';
  const id = connected.id.toLowerCase();
  if (/xbox|045e|xinput/.test(id)) return 'xbox';
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(id)) return 'nin';
  return 'xbox';
}
export const padKind = (): PadKind => { const f = getSettings().pad; return f === 'auto' ? detectKind() : f; };
export const PAD_NAMES: Record<string, string> = { auto: tt('Automático'), kb: tt('Teclado'), xbox: 'Xbox', ps: 'PlayStation', nin: 'Nintendo' };
export function usePadKind(): PadKind {
  useSettings();
  return useSyncExternalStore(f => { padSubs.add(f); return () => padSubs.delete(f); }, padKind);
}

const MAP_KEY = 'cartucho.padmap';
let maps: Record<string, PadMap> = (() => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') as Record<string, PadMap>; } catch { return {}; } })();
let mapVer = 0;
const saveMap = (id: string, m: PadMap) => { maps = { ...maps, [id]: m }; mapVer++; try { localStorage.setItem(MAP_KEY, JSON.stringify(maps)); } catch { } padSubs.forEach(f => f()); };
export const resetPadMap = (id: string) => { const { [id]: _, ...rest } = maps; maps = rest; mapVer++; try { localStorage.setItem(MAP_KEY, JSON.stringify(maps)); } catch { } padSubs.forEach(f => f()); };
export const usePad = () => { usePadKind(); useSyncExternalStore(f => { padSubs.add(f); return () => padSubs.delete(f); }, () => mapVer); return connected; };
export const currentPad = () => connected;

export const SETUP_STEPS: [Key, string, string][] = [
  ['Enter', tt('Confirmar'), tt('A no Xbox · ✕ no PlayStation')], ['Escape', tt('Voltar'), tt('B no Xbox · ○ no PlayStation')],
  ['X', tt('Opções'), tt('X no Xbox · □ no PlayStation')], ['Y', tt('Buscar'), tt('Y no Xbox · △ no PlayStation')],
  ['LB', tt('Seção anterior'), tt('LB · L1')], ['RB', tt('Próxima seção'), tt('RB · R1')], ['LT', tt('Rolar para cima'), tt('LT · L2')], ['RT', tt('Rolar para baixo'), tt('RT · R2')],
  ['Select', tt('Select'), tt('Back · Select · Create')], ['Start', tt('Menu do Cosmo'), tt('Start · Options')],
];
type PadLike = { id: string; mapping: string };
const DEFAULT_PAD: PadLike = { id: '', mapping: 'standard' };
const navMap = (p: PadLike) => keyMapFor(p, padKind() === 'nin');
export function buttonOf(p: PadLike | null, k: Key): number | null {
  const m = navMap(p ?? DEFAULT_PAD);
  for (const i in m) if (m[i] === k) return +i;
  return null;
}
export function rebind(p: PadLike, k: Key, i: number): string | null {
  if (p.mapping === 'standard' && i >= 12 && i <= 16) return tt('Esse botão é fixo: o direcional navega e o Home volta para o palco.');
  const cur: PadMap = {};
  for (const [key] of SETUP_STEPS) { const b = buttonOf(p, key); if (b != null) cur[key] = b; }
  const old = cur[k], other = SETUP_STEPS.map(x => x[0]).find(x => x !== k && cur[x] === i);
  const next: PadMap = { ...cur, [k]: i };
  if (other) { if (old != null) next[other] = old; else delete next[other]; }
  saveMap(p.id, next);
  return null;
}

export interface BindRec { label: string; multi: boolean; pad: PadLike | null; got: number[] }
let rec: BindRec | null = null, recDone: ((r: { pad: PadLike; idx: number[] } | null) => void) | null = null, recUntil = 0, recPad = -1;
const recIgnore = new Map<number, Set<number>>();
const recSubs = new Set<() => void>();
const recEmit = () => recSubs.forEach(f => f());
export const useBindRec = () => useSyncExternalStore(f => { recSubs.add(f); return () => recSubs.delete(f); }, () => rec);
const heldIdx = (p: Gamepad) => new Set(btns(p).flatMap((v, i) => (v ? [i] : [])));
function endRec(ok: boolean) {
  const f = recDone, r = rec; rec = null; recDone = null; recPad = -1;
  for (const q of pads()) prevs.set(q.index, btns(q));
  recEmit();
  f?.(ok && r?.pad && r.got.length ? { pad: r.pad, idx: r.got } : null);
}
export function recordButtons(label: string, multi = false): Promise<{ pad: PadLike; idx: number[] } | null> {
  if (rec) endRec(false);
  recIgnore.clear(); for (const p of pads()) recIgnore.set(p.index, heldIdx(p));
  recUntil = performance.now() + 12_000; recPad = -1;
  rec = { label, multi, pad: null, got: [] }; recEmit();
  return new Promise(r => { recDone = r; });
}
export const cancelBindRec = () => { if (rec) endRec(false); };
function recPoll() {
  const r = rec!;
  let held: number[] = [], pad: Gamepad | null = null;
  for (const p of pads()) {
    const now = heldIdx(p), ign = recIgnore.get(p.index) ?? new Set<number>();
    for (const i of [...ign]) if (!now.has(i)) ign.delete(i);
    recIgnore.set(p.index, ign);
    const h = [...now].filter(i => !ign.has(i));
    if (h.length && (recPad < 0 || recPad === p.index)) { held = h; pad = p; }
  }
  if (held.length && pad) {
    recPad = pad.index;
    const got = [...new Set([...r.got, ...held])].slice(0, 4);
    if (got.length !== r.got.length || !r.pad) { rec = { ...r, pad: { id: pad.id, mapping: pad.mapping }, got }; recEmit(); }
    recUntil = performance.now() + 12_000;
  } else if (r.got.length) endRec(true);
  else if (performance.now() > recUntil) endRec(false);
}
export const tokensOf = (p: PadLike, idx: number[]) => { const m = mapFor(p, false); return idx.map(i => m[i] ?? `#${i}`); };
export function indexOfToken(p: PadLike | null, t: string): number {
  if (t.startsWith('#')) return Number(t.slice(1));
  const m = mapFor(p ?? DEFAULT_PAD, false);
  for (const i in m) if (m[i] === t) return +i;
  return -1;
}
export function BindChips({ bind, pad }: { bind: string[]; pad?: PadLike | null }) {
  const cur = usePad(), p = pad === undefined ? cur : pad;
  return <span className="bind">{bind.map((t, i) => <span key={t} className="bind-k">{i > 0 && <i>+</i>}<PhysGlyph i={indexOfToken(p, t)} pad={p} /></span>)}</span>;
}
export function PadTester() {
  const p = usePad();
  const [on, setOn] = useState<{ n: number; down: number[] }>({ n: 0, down: [] });
  useEffect(() => {
    let last = '';
    const t = setInterval(() => {
      const q = pads().find(x => x.index === connected?.index) ?? pads()[0];
      const b = q ? btns(q) : [];
      const v = { n: b.length, down: b.flatMap((x, i) => (x ? [i] : [])) }, k = JSON.stringify(v);
      if (k !== last) { last = k; setOn(v); }
    }, 50);
    return () => clearInterval(t);
  }, []);
  if (!p) return null;
  return (
    <div className="pad-test">
      <div className="pad-test-h"><b>{p.id.replace(/\s*\(.*$/, '') || tt('Controle')}</b><span>{p.mapping === 'standard' ? tt('{0} botões · layout padrão', { 0: on.n }) : tt('{0} botões · layout genérico', { 0: on.n })}</span></div>
      <div className="pad-test-b">{Array.from({ length: on.n }, (_, i) => <span key={i} className={on.down.includes(i) ? 'on' : ''}><PhysGlyph i={i} pad={p} /></span>)}</div>
    </div>
  );
}

export function IdxChips({ idx, pad }: { idx: number[]; pad: PadLike | null }) {
  return <span className="bind">{idx.map((n, i) => <span key={n} className="bind-k">{i > 0 && <i>+</i>}<PhysGlyph i={n} pad={pad} /></span>)}</span>;
}

const hatAxis = new Map<string, number>();
const HAT: (Key | null)[] = ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
function hatDir(p: Gamepad): Key | null {
  const seen = p.axes.findIndex(v => Math.abs(v) > 1.05);
  if (seen >= 0) hatAxis.set(p.id, seen);
  const h = hatAxis.get(p.id); if (h == null) return null;
  const v = p.axes[h] ?? 2;
  return Math.abs(v) > 1.01 ? null : HAT[Math.round((v + 1) * 3.5) & 7] ?? null;
}

const prevs = new Map<number, boolean[]>(), hats = new Map<number, Key | null>();
let axisAt = 0, held: Key | null = null, heldAt = 0, away = false;
export const keyMapFor = (p: { id: string; mapping: string }, nin: boolean) => mapFor(p, nin, maps[p.id]);
const DIRS = new Set<Key>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const btns = (p: Gamepad) => p.buttons.map(x => x.pressed || x.value > 0.5);
function pads() { return [...(navigator.getGamepads?.() ?? [])].filter((x): x is Gamepad => !!x); }
function touch(p: Gamepad) { if (p.index !== connected?.index || p.id !== connected?.id) { connected = p; padSubs.forEach(f => f()); } }
function activePad() {
  const all = pads();
  if (!all.length) return null;
  const p = all.find(x => x.index === connected?.index) ?? all[0]!;
  touch(p);
  return p;
}
function poll() {
  if (document.hidden || (!document.hasFocus() && !document.querySelector('.web-ov'))) { away = true; held = null; return; }
  if (rec) { recPoll(); return; }
  const all = pads();
  if (!all.length) return;
  const now = performance.now();
  if (away) { away = false; for (const p of all) prevs.set(p.index, btns(p)); axisAt = now + 400; return; }
  let dir = false, stick: Key | null = null;
  for (const p of all) {
    const b = btns(p), old = prevs.get(p.index) ?? b;
    prevs.set(p.index, b);
    const pressed = b.findIndex((v, i) => v && !old[i]);
    const map = keyMapFor(p, padKind() === 'nin');
    if (pressed >= 0) { setLast('pad'); setHand('pad'); touch(p); }
    for (const i in map) if (b[+i] && !old[+i]) { send(map[i]!); if (DIRS.has(map[i]!)) { held = map[i]!; heldAt = now + 250; } }
    const hat = hatDir(p);
    if (hat && hat !== hats.get(p.index)) { setLast('pad'); setHand('pad'); touch(p); send(hat); held = hat; heldAt = now + 250; }
    hats.set(p.index, hat);
    if (hat || Object.keys(map).some(i => b[+i] && DIRS.has(map[+i]!))) dir = true;
    const [ax = 0, ay = 0] = p.axes;
    if (!stick && (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6)) { touch(p); stick = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'ArrowRight' : 'ArrowLeft') : (ay > 0 ? 'ArrowDown' : 'ArrowUp'); }
  }
  if (!dir) held = null;
  else if (held && now > heldAt) { send(held); heldAt = now + 110; }
  if (stick) { setLast('pad'); setHand('pad'); if (now - axisAt > 180) { axisAt = now; send(stick); } } else axisAt = 0;
}
if (typeof window !== 'undefined') setInterval(poll, 16);

type Act = 'ok' | 'back' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'menu' | 'sel' | 'ud' | 'lr' | 'home';
const PS: Record<string, ReactNode> = {
  ok: <svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="#8fb0ff" strokeWidth="2.6" strokeLinecap="round" /></svg>,
  back: <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.2" fill="none" stroke="#ff6f6f" strokeWidth="2.4" /></svg>,
  x: <svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" fill="none" stroke="#f08ad8" strokeWidth="2.4" /></svg>,
  y: <svg viewBox="0 0 20 20"><path d="M10 4.5l5.8 10H4.2z" fill="none" stroke="#4fd6a8" strokeWidth="2.3" strokeLinejoin="round" /></svg>,
};
const GL: Record<PadKind, Record<Act, string | [string, string] | ReactNode>> = {
  kb: { ok: tt('Enter'), back: 'Esc', x: 'X', y: 'Y', lb: 'Q', rb: 'E', lt: 'PgUp', rt: 'PgDn', menu: 'F1', sel: 'F2', ud: '↑↓', lr: '←→', home: 'Home' },
  xbox: { ok: ['A', '#6ad13a'], back: ['B', '#ff5a4f'], x: ['X', '#4a95ff'], y: ['Y', '#ffc928'], lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', menu: '☰', sel: '⧉', ud: '✚', lr: '✚', home: 'Xbox' },
  ps: { ok: PS.ok, back: PS.back, x: PS.x, y: PS.y, lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', menu: 'OPTIONS', sel: 'CREATE', ud: '✚', lr: '✚', home: 'PS' },
  nin: { ok: ['A', '#fff'], back: ['B', '#fff'], x: ['Y', '#fff'], y: ['X', '#fff'], lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', menu: '+', sel: '−', ud: '✚', lr: '✚', home: '⌂' },
};
const ARROW: Record<number, string> = { 12: '↑', 13: '↓', 14: '←', 15: '→' };
const PHYS: Record<Exclude<PadKind, 'kb'>, Record<number, string | [string, string] | ReactNode>> = {
  xbox: { 0: ['A', '#6ad13a'], 1: ['B', '#ff5a4f'], 2: ['X', '#4a95ff'], 3: ['Y', '#ffc928'], 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: '⧉', 9: '☰', 10: 'LS', 11: 'RS', ...ARROW, 16: 'Xbox', 17: 'Share' },
  ps: { 0: PS.ok, 1: PS.back, 2: PS.x, 3: PS.y, 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'CREATE', 9: 'OPTIONS', 10: 'L3', 11: 'R3', ...ARROW, 16: 'PS', 17: 'TOUCHPAD' },
  nin: { 0: ['B', '#fff'], 1: ['A', '#fff'], 2: ['Y', '#fff'], 3: ['X', '#fff'], 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+', 10: 'LS', 11: 'RS', ...ARROW, 16: '⌂', 17: '◉' },
};
const ACT_KEY: Partial<Record<Act, Key>> = { ok: 'Enter', back: 'Escape', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', menu: 'Start', sel: 'Select' };
function show(v: string | [string, string] | ReactNode) {
  if (Array.isArray(v) && typeof v[0] === 'string') return <span className="gp r" style={{ color: v[1] as string }}>{v[0]}</span>;
  if (typeof v === 'string') return <span className="gp pill">{v}</span>;
  return <span className="gp r">{v}</span>;
}
export function PhysGlyph({ i, pad }: { i: number; pad?: PadLike | null }) {
  const kind = usePadKind(), k = kind === 'kb' ? 'xbox' : kind;
  const std = (pad ?? connected ?? DEFAULT_PAD).mapping === 'standard';
  if (i < 0) return <span className="gp pill">?</span>;
  const v = std ? PHYS[k][i] : null;
  return v != null ? show(v) : <span className="gp pill">{tt('B{0}', { 0: i + 1 })}</span>;
}
export function Glyph({ a, pad }: { a: Act; pad?: boolean }) {
  const kind = usePadKind(), k = pad && kind === 'kb' ? 'xbox' : kind, v = GL[k][a];
  const p = usePad();
  const km = useKbMap();
  if (k === 'kb') { const ak = ACT_KEY[a], first = ak ? km[ak]?.[0] : undefined; return <span className="gp kb">{ak ? (first ? keyLabel(first) : '—') : v as string}</span>; }
  const key = ACT_KEY[a];
  if (key && p && maps[p.id]) { const i = buttonOf(p, key); if (i != null) return <PhysGlyph i={i} pad={p} />; }
  return show(v);
}
export function Hints({ items }: { items: [Act, string][] }) {
  return <footer className="hints">{items.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</footer>;
}
