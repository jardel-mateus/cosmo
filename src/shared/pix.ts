/**
 * Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central).
 * Gera o texto que vira QR code; qualquer app de banco lê e abre a tela de pagamento.
 */
const f = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no campo 63 do BR Code. */
export function crc16(s: string) {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Sem acentos e só ASCII, cortado no tamanho que o padrão aceita. */
const ascii = (s: string, max: number) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, max);

export function pixPayload({ key, name, city, amount, txid = '***', message }: { key: string; name: string; city: string; amount?: number; txid?: string; message?: string }) {
  const acct = f('00', 'br.gov.bcb.pix') + f('01', key.trim()) + (message ? f('02', ascii(message, 60)) : '');
  const body = f('00', '01') + f('26', acct) + f('52', '0000') + f('53', '986')
    + (amount && amount > 0 ? f('54', amount.toFixed(2)) : '')
    + f('58', 'BR') + f('59', ascii(name, 25) || 'COSMO') + f('60', ascii(city, 15) || 'BRASIL')
    + f('62', f('05', ascii(txid, 25) || '***')) + '6304';
  return body + crc16(body);
}
