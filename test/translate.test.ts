import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/main/db';
import { chunks, Translator } from '../src/main/translate';

const reply = (text: string, status = 200) => ({ ok: true, status: 200, json: async () => ({ responseStatus: status, responseData: { translatedText: text } }) });

describe('tradução dos textos do catálogo', () => {
  it('divide textos longos por frase, sem passar do limite do serviço', () => {
    const t = 'Uma frase curta. ' + 'palavra '.repeat(120) + 'fim. Outra frase!';
    const c = chunks(t, 200);
    expect(c.every(x => x.length <= 200)).toBe(true);
    expect(c.join(' ').replace(/\s+/g, ' ')).toBe(t.trim().replace(/\s+/g, ' '));
  });

  it('traduz uma vez, guarda no banco e decodifica entidades', async () => {
    const db = openDb(':memory:');
    const fetch = vi.fn(async (url: string) => reply(new URL(url).searchParams.get('q') === 'Your own copy.' ? 'Sua própria cópia &quot;original&quot;.' : '?'));
    const tr = new Translator(db, fetch, 'http://x/get');
    expect(await tr.translate('Your own copy.')).toBe('Sua própria cópia "original".');
    expect(await tr.translate('Your own copy.')).toBe('Sua própria cópia "original".');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('langpair')).toBe('en|pt-BR');
    expect(new Translator(db, fetch, 'http://x/get').cached('Your own copy.')).toBe('Sua própria cópia "original".');
  });

  it('cota esgotada: devolve null (a tela mostra o original) e não insiste por um tempo', async () => {
    const db = openDb(':memory:');
    const fetch = vi.fn(async () => reply('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY', 429));
    const tr = new Translator(db, fetch, 'http://x/get');
    expect(await tr.translate('Hello.')).toBeNull();
    expect(await tr.translate('World.')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tr.cached('Hello.')).toBeNull();
  });
});
