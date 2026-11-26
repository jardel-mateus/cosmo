/**
 * KeyValues binário da Valve (o formato dos arquivos de appcache/stats da Steam).
 * Cada entrada é: tipo (1 byte) | chave terminada em 0 | valor. Um tipo 0x08 (ou 0x0B) fecha o mapa atual.
 */
export type KV = string | number | bigint | KVMap;
export interface KVMap { [k: string]: KV }

const utf8 = new TextDecoder('utf-8');

export function parseBinaryKV(buf: Uint8Array): KVMap {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const need = (n: number) => { if (pos + n > buf.byteLength) throw new RangeError('KeyValues binário terminou no meio'); };
  const cstr = () => { const s = pos; while (pos < buf.byteLength && buf[pos] !== 0) pos++; need(1); const t = utf8.decode(buf.subarray(s, pos)); pos++; return t; };
  const wstr = () => { const s = pos; while (pos + 1 < buf.byteLength && (buf[pos] || buf[pos + 1])) pos += 2; need(2); const t = new TextDecoder('utf-16le').decode(buf.subarray(s, pos)); pos += 2; return t; };
  const map = (depth: number): KVMap => {
    if (depth > 64) throw new RangeError('KeyValues binário fundo demais');
    const out: KVMap = {};
    while (pos < buf.byteLength) {
      const t = buf[pos++]!;
      if (t === 0x08 || t === 0x0b) return out;
      const k = cstr();
      switch (t) {
        case 0x00: out[k] = map(depth + 1); break;
        case 0x01: out[k] = cstr(); break;
        case 0x02: case 0x04: case 0x06: need(4); out[k] = view.getInt32(pos, true); pos += 4; break;
        case 0x03: need(4); out[k] = view.getFloat32(pos, true); pos += 4; break;
        case 0x05: out[k] = wstr(); break;
        case 0x07: need(8); out[k] = view.getBigUint64(pos, true); pos += 8; break;
        case 0x0a: need(8); out[k] = view.getBigInt64(pos, true); pos += 8; break;
        default: throw new RangeError(`tipo de KeyValues desconhecido (0x${t.toString(16)})`);
      }
    }
    return out;
  };
  return map(0);
}

export const isMap = (v: KV | undefined): v is KVMap => !!v && typeof v === 'object';
export const num = (v: KV | undefined) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null);
/** Procura uma chave em qualquer nível (até `depth`). */
export function findKey(m: KVMap, key: string, depth = 3): KV | undefined {
  if (key in m) return m[key];
  if (depth <= 0) return undefined;
  for (const v of Object.values(m)) if (isMap(v)) { const r = findKey(v, key, depth - 1); if (r !== undefined) return r; }
  return undefined;
}

/** Escreve KeyValues binário (usado nos testes para montar arquivos de exemplo). */
export function writeBinaryKV(m: KVMap): Uint8Array {
  const parts: number[] = [];
  const str = (s: string) => { for (const b of new TextEncoder().encode(s)) parts.push(b); parts.push(0); };
  const walk = (o: KVMap) => {
    for (const [k, v] of Object.entries(o)) {
      if (isMap(v)) { parts.push(0x00); str(k); walk(v); parts.push(0x08); }
      else if (typeof v === 'string') { parts.push(0x01); str(k); str(v); }
      else if (typeof v === 'number') { parts.push(0x02); str(k); const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); parts.push(...b); }
      else { parts.push(0x07); str(k); const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); parts.push(...b); }
    }
  };
  walk(m); parts.push(0x08);
  return new Uint8Array(parts);
}
