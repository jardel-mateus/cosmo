/** Arquivos sintéticos, montados byte a byte com os mesmos layouts que os recomps e o Xbox 360 usam. */

export class Writer {
  private parts: number[] = [];
  constructor(private le = false) {}
  get length() { return this.parts.length; }
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  u16(v: number) { const b = new DataView(new ArrayBuffer(2)); b.setUint16(0, v, this.le); return this.raw(new Uint8Array(b.buffer)); }
  u32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v >>> 0, this.le); return this.raw(new Uint8Array(b.buffer)); }
  u64(v: bigint | number) { const b = new DataView(new ArrayBuffer(8)); b.setBigUint64(0, BigInt(v), this.le); return this.raw(new Uint8Array(b.buffer)); }
  i64(v: bigint | number) { const b = new DataView(new ArrayBuffer(8)); b.setBigInt64(0, BigInt(v), this.le); return this.raw(new Uint8Array(b.buffer)); }
  ascii(s: string) { for (const c of s) this.parts.push(c.charCodeAt(0)); return this; }
  raw(b: Uint8Array) { for (const x of b) this.parts.push(x); return this; }
  zeros(n: number) { for (let i = 0; i < n; i++) this.parts.push(0); return this; }
  bytes() { return new Uint8Array(this.parts); }
}
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface FakeAch { id: number; name: string; desc: string; gs: number; imageId: number }
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** XDBF big-endian com XACH, XSTC, textos em inglês (e opcionalmente português) e uma imagem por conquista. */
export function buildXdbf(achs: FakeAch[], opts: { portuguese?: Record<number, string> } = {}) {
  const blocks: { section: number; id: bigint; data: Uint8Array }[] = [];

  const xach = new Writer().ascii('XACH').u32(1).u32(0).u16(achs.length);
  achs.forEach((a, i) => xach.u16(a.id).u16(100 + i * 2).u16(101 + i * 2).u16(101 + i * 2).u32(a.imageId).u16(a.gs).u16(0).u32(0).zeros(16));
  blocks.push({ section: 1, id: 0x58414348n, data: xach.bytes() });
  blocks.push({ section: 1, id: 0x58535443n, data: new Writer().ascii('XSTC').u32(1).u32(4).u32(1).bytes() });

  const strings = (names: Record<number, string>) => {
    const entries = Object.entries(names);
    const w = new Writer().ascii('XSTR').u32(1).u32(0).u16(entries.length);
    for (const [id, s] of entries) { const b = utf8(s); w.u16(Number(id)).u16(b.length).raw(b); }
    return w.bytes();
  };
  const en: Record<number, string> = {};
  achs.forEach((a, i) => { en[100 + i * 2] = a.name; en[101 + i * 2] = a.desc; });
  blocks.push({ section: 3, id: 1n, data: strings(en) });
  if (opts.portuguese) blocks.push({ section: 3, id: 9n, data: strings(opts.portuguese) });
  for (const a of achs) blocks.push({ section: 2, id: BigInt(a.imageId), data: PNG });

  const free = 1;
  const w = new Writer().ascii('XDBF').u32(0x10000).u32(blocks.length).u32(blocks.length).u32(free).u32(1);
  let off = 0;
  for (const b of blocks) { w.u16(b.section).u64(b.id).u32(off).u32(b.data.length); off += b.data.length; }
  w.u32(0).u32(0);
  for (const b of blocks) w.raw(b.data);
  return w.bytes();
}

/** Imagem descriptografada do MarathonRecomp: cabeçalho LE 0xDECDECDE + imagem crua com o XDBF dentro. */
export function buildDecryptedImage(xdbf: Uint8Array, base = 0x82000000, resAddr = 0x82000400) {
  const img = new Uint8Array(resAddr - base + xdbf.length + 64);
  img.set(xdbf, resAddr - base);
  return new Writer(true).u32(0xdecdecde).u64(base).u64(base + 0x100).u64(resAddr).u64(xdbf.length).raw(img).bytes();
}

/**
 * XEX2 sem criptografia. compression 0 = imagem inteira depois do cabeçalho; 1 = blocos {dados, zeros}
 * (com zeros inseridos antes do XDBF, para testar a remontagem).
 */
export function buildXex2(xdbf: Uint8Array, compression: 0 | 1, opts: { encryption?: number } = {}) {
  const load = 0x82000000, resOffset = 0x300;
  const image = new Uint8Array(resOffset + xdbf.length + 32);
  image.set(xdbf, resOffset);

  // Blocos: [0, 0x100) dados, 0x100 zeros (não gravados no arquivo), depois o resto como dados.
  const blocks = compression === 1 ? [{ data: image.subarray(0, 0x100), zero: 0x100 }, { data: image.subarray(0x200), zero: 0 }] : [];
  // infoSize = 8 bytes de cabeçalho + 8 por bloco (o leitor faz infoSize/8 - 1 blocos, como o XenonRecomp)
  const fmtFixed = new Writer().u32(8 + blocks.length * 8).u16(opts.encryption ?? 0).u16(compression);
  for (const b of blocks) fmtFixed.u32(b.data.length).u32(b.zero);

  const resInfo = new Writer().u32(4 + 16).ascii('ABCD1234').u32(load + resOffset).u32(xdbf.length).bytes();

  const headerCount = 2;
  const fixed = 24 + headerCount * 8;
  const fmtAt = fixed, resAt = fmtAt + fmtFixed.length, secAt = resAt + resInfo.length;
  const security = new Writer().zeros(0x110).u32(load).zeros(12).bytes();
  const headerSize = Math.ceil((secAt + security.length) / 0x100) * 0x100;

  const w = new Writer().ascii('XEX2').u32(0).u32(headerSize).u32(0).u32(secAt).u32(headerCount)
    .u32(0x3ff).u32(fmtAt).u32(0x2ff).u32(resAt).raw(fmtFixed.bytes()).raw(resInfo).raw(security);
  w.zeros(headerSize - w.length);
  if (compression === 0) w.raw(image);
  else for (const b of blocks) w.raw(b.data);
  return w.bytes();
}

/** ACH-DATA do hedge-dev (UnleashedRecomp/MarathonRecomp). */
export function buildHedgeAch(unlocks: { id: number; time: number }[], records = 50, opts: { badChecksum?: boolean } = {}) {
  const body = new Writer(true);
  for (let i = 0; i < records; i++) { const u = unlocks[i]; body.u16(u?.id ?? 0).i64(u?.time ?? 0).zeros(6); }
  const b = body.bytes();
  let x = 0; for (const v of b) x ^= v;
  return new Writer(true).ascii('ACH ').u32(1).u32(opts.badChecksum ? x ^ 1 : x).u32(0).raw(b).bytes();
}

/** s3air_achievements.bin (Oxygen Engine PersistentData). */
export function buildOxygen(states: [number, number][], extraKeys: string[] = ['Other']) {
  const ach = new Writer(true).u32(states.length);
  for (const [id, s] of states) ach.u32(id).u32(s);
  const entries: [string, Uint8Array][] = [...extraKeys.map(k => [k, utf8('x')] as [string, Uint8Array]), ['Achievements', ach.bytes()]];
  const w = new Writer(true).ascii('OXY.PDATA').u16(0x100).u32(entries.length);
  for (const [k, d] of entries) { const kb = utf8(k); w.u32(kb.length).raw(kb).u32(d.length).raw(d); }
  return w.bytes();
}

/** UData.bin do Retro Engine v4. */
export function buildUData(unlocked: number[]) {
  const w = new Writer(true);
  for (let i = 0; i < 64; i++) w.u32(unlocked.includes(i) ? 100 : 0);
  for (let i = 0; i < 128; i++) w.u32(0);
  return w.bytes();
}

// ---------- zip (sem compressão), para testar instalação ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Zip "stored" com os arquivos dados (caminho → conteúdo). */
export function buildZip(files: Record<string, string | Uint8Array>) {
  const local = new Writer(true), central = new Writer(true);
  let count = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const nb = new TextEncoder().encode(name), crc = crc32(data), off = local.length;
    local.u32(0x04034b50).u16(20).u16(0).u16(0).u16(0).u16(0).u32(crc).u32(data.length).u32(data.length).u16(nb.length).u16(0).raw(nb).raw(data);
    central.u32(0x02014b50).u16(20).u16(20).u16(0).u16(0).u16(0).u16(0).u32(crc).u32(data.length).u32(data.length).u16(nb.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(off).raw(nb);
    count++;
  }
  const cd = central.bytes(), lb = local.bytes();
  return new Writer(true).raw(lb).raw(cd).u32(0x06054b50).u16(0).u16(0).u16(count).u16(count).u32(cd.length).u32(lb.length).u16(0).bytes();
}
