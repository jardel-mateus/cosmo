import { describe, expect, it } from 'vitest';
import { crc16, pixPayload } from '../src/shared/pix';

describe('Pix copia e cola', () => {
  it('bate com o exemplo do manual do BR Code do Banco Central', () => {
    expect(pixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA' }))
      .toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  });
  it('CRC do payload confere e acentos viram ASCII', () => {
    const p = pixPayload({ key: 'a@b.com', name: 'João Ação', city: 'São Paulo', message: 'Apoio ao Cosmo' });
    expect(p).toContain('5909Joao Acao');
    expect(p).toContain('6009Sao Paulo');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});
