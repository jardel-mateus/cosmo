export type Key = 'Enter' | 'Escape' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Tab' | 'LB' | 'RB' | 'LT' | 'RT' | 'X' | 'Y' | 'Start' | 'Select' | 'Home';
export type PadMap = Partial<Record<Key, number>>;

const STANDARD: Record<number, Key> = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Select', 9: 'Start', 16: 'Home' };
const DPAD: Record<number, Key> = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 16: 'Home' };
const GENERIC: Record<number, Key> = { 2: 'Enter', 1: 'Escape', 3: 'X', 0: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Select', 9: 'Start' };
const PS2_ADAPTER: Record<number, Key> = { 2: 'Enter', 1: 'Escape', 3: 'X', 0: 'Y', 6: 'LB', 7: 'RB', 4: 'LT', 5: 'RT', 8: 'Select', 9: 'Start' };
const KNOWN: Record<string, Record<number, Key>> = { '0810:0001': PS2_ADAPTER, '0925:8866': PS2_ADAPTER, '0e8f:0003': PS2_ADAPTER, '0e8f:3013': PS2_ADAPTER };
export const padUsbId = (id: string) => {
  const v = id.match(/vendor:?\s*([0-9a-f]{4})/i)?.[1], pr = id.match(/product:?\s*([0-9a-f]{4})/i)?.[1];
  return v && pr ? `${v}:${pr}`.toLowerCase() : null;
};
export function keyMapFor(p: { id: string; mapping: string }, nin: boolean, custom?: PadMap): Record<number, Key> {
  if (custom) { const m: Record<number, Key> = p.mapping === 'standard' ? { ...DPAD } : {}; for (const [k, i] of Object.entries(custom)) if (i != null) m[i] = k as Key; return m; }
  if (p.mapping !== 'standard') return KNOWN[padUsbId(p.id) ?? ''] ?? GENERIC;
  return nin ? { ...STANDARD, 0: 'Escape', 1: 'Enter' } : STANDARD;
}
