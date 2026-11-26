/** Leitura de binários com verificação de limites (formatos de console são big-endian; os de PC, little-endian). */
export class Reader {
  private view: DataView;
  pos = 0;
  constructor(readonly buf: Uint8Array, private le = false) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get length() { return this.buf.byteLength; }
  get remaining() { return this.buf.byteLength - this.pos; }
  private need(n: number, at = this.pos) {
    if (at < 0 || at + n > this.buf.byteLength) throw new RangeError(`leitura fora do arquivo (${at}+${n} > ${this.buf.byteLength})`);
  }
  seek(p: number) { this.need(0, p); this.pos = p; return this; }
  skip(n: number) { this.need(n); this.pos += n; return this; }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, this.le); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, this.le); this.pos += 4; return v; }
  u64() { this.need(8); const v = this.view.getBigUint64(this.pos, this.le); this.pos += 8; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos, this.le); this.pos += 8; return v; }
  bytes(n: number) { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  ascii(n: number) { return new TextDecoder('latin1').decode(this.bytes(n)); }
  utf8(n: number) { return new TextDecoder('utf-8').decode(this.bytes(n)); }
  u32At(at: number) { this.need(4, at); return this.view.getUint32(at, this.le); }
}

export const fourcc = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
