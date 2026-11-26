import { describe, expect, it } from 'vitest';
import { friendlyUpdError } from '../src/main/updater';

describe('mensagens da atualização', () => {
  it('release ainda sem latest.yml vira aviso curto e tenta de novo logo', () => {
    const r = friendlyUpdError('Cannot find latest.yml in the latest release artifacts (https://github.com/x/releases/download/v1.0.8/latest.yml): HttpError: 404 "method: GET\nHeaders: {...}');
    expect(r).toEqual({ text: expect.stringContaining('sendo publicada'), soon: true });
  });

  it('sem internet também tenta de novo, e outros erros mostram só a primeira linha', () => {
    expect(friendlyUpdError('net::ERR_INTERNET_DISCONNECTED').soon).toBe(true);
    const r = friendlyUpdError('algo quebrou\n    at x (y.js:1:1)');
    expect(r).toEqual({ text: 'Não deu para verificar: algo quebrou', soon: false });
  });
});
