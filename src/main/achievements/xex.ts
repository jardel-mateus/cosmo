/**
 * Tira o XDBF (lista original de conquistas) de dentro do executável de um jogo de Xbox 360.
 *
 * Dois formatos que os recomps deixam no disco depois de instalar:
 *  - XEX2 já descriptografado (UnleashedRecomp grava `patched/default.xex`): sem criptografia e com
 *    compressão "nenhuma" ou "básica". O XEX original do disco vem criptografado e com compressão LZX;
 *    esse caso não é tratado aqui (o recomp já faz isso por nós na instalação).
 *  - Imagem descriptografada do MarathonRecomp (`decrypted/default.bin`): cabeçalho 0xDECDECDE + imagem crua.
 *
 * Estruturas conforme XenonRecomp (XenonUtils/xex.h) e MarathonRecomp (install/installer.h).
 */
import { Reader, fourcc } from './binary';

const XEX_HEADER_RESOURCE_INFO = 0x000002ff;
const XEX_HEADER_FILE_FORMAT_INFO = 0x000003ff;
const COMPRESSION_NONE = 0, COMPRESSION_BASIC = 1;
const DECRYPTED_MAGIC = 0xdecdecde;

export class UnsupportedExecutable extends Error {}

/** Devolve os bytes do XDBF, ou lança UnsupportedExecutable explicando por quê. */
export function xdbfFromExecutable(file: Uint8Array): Uint8Array {
  if (file.byteLength >= 36 && new Reader(file, true).u32() === DECRYPTED_MAGIC) return fromDecryptedImage(file);
  if (file.byteLength >= 24 && new Reader(file).u32() === fourcc('XEX2')) return fromXex2(file);
  throw new UnsupportedExecutable('formato de executável desconhecido');
}

function fromDecryptedImage(file: Uint8Array): Uint8Array {
  const r = new Reader(file, true);
  r.u32();
  const base = Number(r.u64()); r.u64();
  const resourceOffset = Number(r.u64()), resourceSize = Number(r.u64());
  const start = r.pos + (resourceOffset - base);
  if (resourceSize <= 0 || start < r.pos || start + resourceSize > file.byteLength) throw new UnsupportedExecutable('recurso XDBF fora da imagem');
  return file.subarray(start, start + resourceSize);
}

function fromXex2(file: Uint8Array): Uint8Array {
  const r = new Reader(file);
  r.u32(); r.u32();
  const headerSize = r.u32(); r.u32();
  const securityOffset = r.u32(), headerCount = r.u32();

  const opt = new Map<number, number>();
  for (let i = 0; i < headerCount; i++) { const key = r.u32(), value = r.u32(); opt.set(key, value); }
  const optPtr = (key: number) => { const v = opt.get(key); if (v === undefined) return null; return (key & 0xff) <= 1 ? null : v; };

  const fmtAt = optPtr(XEX_HEADER_FILE_FORMAT_INFO), resAt = optPtr(XEX_HEADER_RESOURCE_INFO);
  if (fmtAt === null || resAt === null) throw new UnsupportedExecutable('XEX sem informação de recursos');

  const f = new Reader(file).seek(fmtAt);
  const infoSize = f.u32(), encryption = f.u16(), compression = f.u16();
  if (encryption !== 0) throw new UnsupportedExecutable('XEX criptografado: use o executável que o recomp gerou na instalação');
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_BASIC) throw new UnsupportedExecutable('XEX com compressão LZX não é suportado');

  const loadAddress = new Reader(file).u32At(securityOffset + 4 + 4 + 0x100 + 4 + 4);
  const res = new Reader(file).seek(resAt);
  res.u32(); res.skip(8);
  const resAddress = res.u32(), resSize = res.u32();
  const want = resAddress - loadAddress;
  if (want < 0 || resSize <= 0) throw new UnsupportedExecutable('endereço de recurso inválido');

  // Monta só o trecho da imagem que interessa: [want, want + resSize).
  const out = new Uint8Array(resSize);
  let src = headerSize, dst = 0;
  const copy = (srcStart: number, len: number, dstStart: number) => {
    const a = Math.max(dstStart, want), b = Math.min(dstStart + len, want + resSize);
    if (a < b) out.set(file.subarray(srcStart + (a - dstStart), srcStart + (b - dstStart)), a - want);
  };
  if (compression === COMPRESSION_NONE) copy(src, file.byteLength - src, 0);
  else {
    const blocks = Math.floor(infoSize / 8) - 1;
    const b = new Reader(file).seek(fmtAt + 8);
    for (let i = 0; i < blocks; i++) {
      const dataSize = b.u32(), zeroSize = b.u32();
      copy(src, dataSize, dst);
      src += dataSize; dst += dataSize + zeroSize;   // os zeros já estão em `out`
      if (dst >= want + resSize) break;
    }
  }
  return out;
}
