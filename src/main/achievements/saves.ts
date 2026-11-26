import { Reader } from './binary';
import { tt } from '@shared/i18n';

/** `name` é o nome de API (Steam, GOG), usado quando a lista não tem essa conquista. */
export interface Unlock { id: number; at: number | null; name?: string }

export function readHedgeAch(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true);
  if (r.ascii(4) !== 'ACH ') throw new Error(tt('arquivo de conquistas sem assinatura ACH'));
  const version = r.u32(), checksum = r.u32(); r.u32();
  if (version !== 1) throw new Error(tt('versão de conquistas desconhecida ({0})', { 0: version }));
  if ((buf.byteLength - 16) % 16 !== 0) throw new Error(tt('tamanho inesperado do arquivo de conquistas'));
  let x = 0; for (let i = 16; i < buf.byteLength; i++) x ^= buf[i]!;
  if (x !== checksum) throw new Error(tt('checksum das conquistas não confere (arquivo sendo gravado?)'));
  const out: Unlock[] = [];
  while (r.remaining >= 16) {
    const id = r.u16(), t = r.i64(); r.skip(6);
    if (!id) break;
    out.push({ id, at: t > 0n ? Number(t) * 1000 : null });
  }
  return out;
}

export function readOxygenAchievements(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true);
  if (r.ascii(9) !== 'OXY.PDATA') throw new Error(tt('não é um arquivo de dados do Oxygen Engine'));
  const version = r.u16();
  if (version < 0x100 || version > 0x1ff) throw new Error(tt('versão de dados desconhecida ({0})', { 0: version }));
  const entries = r.u32();
  for (let i = 0; i < entries; i++) {
    const key = r.utf8(r.u32()), data = r.bytes(r.u32());
    if (key !== 'Achievements') continue;
    const d = new Reader(data, true), n = d.u32(), out: Unlock[] = [];
    for (let j = 0; j < n; j++) { const id = d.u32(), state = d.u32(); if (state) out.push({ id, at: null }); }
    return out;
  }
  return [];
}

export function readRsdkUserdata(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true), out: Unlock[] = [];
  for (let i = 0; i < 64 && r.remaining >= 4; i++) if (r.u32() === 100) out.push({ id: i, at: null });
  return out;
}
