import { describe, expect, it } from 'vitest';
import { keyMapFor, padUsbId } from '../src/shared/padmap';

describe('controles', () => {
  it('lê vendor e product do nome que o Chromium dá ao controle', () => {
    expect(padUsbId('Twin USB Joystick (Vendor: 0810 Product: 0001)')).toBe('0810:0001');
    expect(padUsbId('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBeNull();
  });

  it('controle padrão segue o layout do Xbox', () => {
    const m = keyMapFor({ id: 'Xbox Wireless Controller', mapping: 'standard' }, false);
    expect([m[0], m[1], m[12], m[9]]).toEqual(['Enter', 'Escape', 'ArrowUp', 'Start']);
  });

  it('controle genérico e adaptador de PS2 funcionam sem configurar nada, com ✕ confirmando e ○ voltando', () => {
    const g = keyMapFor({ id: 'USB Gamepad (Vendor: 0079 Product: 0006)', mapping: '' }, false);
    expect([g[2], g[1], g[3], g[0], g[9]]).toEqual(['Enter', 'Escape', 'X', 'Y', 'Start']);
    const ps2 = keyMapFor({ id: 'Twin USB Joystick (Vendor: 0810 Product: 0001)', mapping: '' }, false);
    expect([ps2[2], ps2[1], ps2[6], ps2[7], ps2[4]]).toEqual(['Enter', 'Escape', 'LB', 'RB', 'LT']);
  });
});
