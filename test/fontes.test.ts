import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const entry = (over: Record<string, unknown>) => ({ entry: 'x', nombre: 'X', repo: 'a/x', consola: 'n64', estado: 'playable', ...over });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('fontes extras de jogos e de capas', async () => {
  const { openDb } = await import('../src/main/db');
  const { refreshCatalog, listCatalog, setExtraCatalogs } = await import('../src/main/catalog');
  const { createLibretro } = await import('../src/main/artwork/libretro');
  const { looseKey } = await import('../src/main/artwork/service');
  afterEach(() => { vi.unstubAllGlobals(); setExtraCatalogs([]); });

  it('junta catálogos extras (URL e arquivo) ao principal; o principal ganha em caso de repetição; extra quebrado é ignorado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmo-'));
    const file = join(dir, 'meus.json');
    writeFileSync(file, '﻿' + JSON.stringify([entry({ entry: 'local/a', nombre: 'Jogo Local' }), { lixo: 1 }]));
    setExtraCatalogs([' https://extra.test/c.json ', file, 'https://quebrado.test/x.json', file]);
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('recompendium')) return json({ formato: 1, entradas: [entry({ entry: 'r/1', nombre: 'Principal' })] });
      if (url.includes('extra.test')) return json({ formato: 1, entradas: [entry({ entry: 'r/1', nombre: 'Duplicado' }), entry({ entry: 'e/2', nombre: 'Extra', consola: 'ps2' })] });
      return new Response('x', { status: 500 });
    });
    vi.stubGlobal('fetch', fetch);
    const db = openDb(':memory:');
    const r = await refreshCatalog(db);
    expect(r.total).toBe(3);
    expect(listCatalog(db).map(g => g.title).sort()).toEqual(['Extra', 'Jogo Local', 'Principal']);
    // Com extras, não manda If-None-Match (o principal pode não mudar, mas os extras sim).
    expect((fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers['If-None-Match']).toBeUndefined();
  });

  it('libretro: casa o título sem região, prefere USA, guarda a lista e devolve a URL raw do GitHub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmo-lr-'));
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/git/trees/HEAD')) return json({ tree: [{ path: 'Named_Boxarts', type: 'tree', sha: 'abc' }] });
      if (url.endsWith('/git/trees/abc')) return json({ tree: [
        { path: 'Super Mario 64 (Japan).png', type: 'blob' }, { path: 'Super Mario 64 (USA).png', type: 'blob' }, { path: 'Wave Race 64 (Europe).png', type: 'blob' },
      ] });
      return new Response('nada', { status: 404 });
    });
    const lr = createLibretro({ folder: dir, fetch: fetch as never, key: looseKey, api: 'https://api.test', raw: 'https://raw.test' });
    const urls = await lr.find('n64', ['Super Mario 64'], 'cover');
    expect(urls[0]).toBe('https://raw.test/libretro-thumbnails/Nintendo_-_Nintendo_64/master/Named_Boxarts/Super%20Mario%2064%20(USA).png');
    expect(await lr.find('n64', ['Jogo Que Não Existe'], 'cover')).toEqual([]);
    expect(await lr.find('pc', ['Doom'], 'cover')).toEqual([]);
    expect(calls.filter(u => u.includes('/git/trees/')).length).toBe(2);
    // Segunda instância lê a lista do disco, sem ir ao GitHub.
    const lr2 = createLibretro({ folder: dir, fetch: fetch as never, key: looseKey, api: 'https://api.test', raw: 'https://raw.test' });
    expect((await lr2.find('n64', ['wave race 64'], 'cover')).length).toBe(1);
    expect(calls.filter(u => u.includes('/git/trees/')).length).toBe(2);
  });

  it('libretro: erro do GitHub sobe (para não marcar a capa como inexistente) e tenta de novo depois', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmo-lr2-'));
    const fetch = vi.fn().mockResolvedValueOnce(new Response('limite', { status: 403 }))
      .mockResolvedValueOnce(json({ tree: [{ path: 'Named_Boxarts', type: 'tree', sha: 's' }] }))
      .mockResolvedValueOnce(json({ tree: [{ path: 'Sonic The Hedgehog (USA, Europe).png', type: 'blob' }] }));
    const lr = createLibretro({ folder: dir, fetch: fetch as never, key: looseKey });
    await expect(lr.find('megadrive', ['Sonic the Hedgehog'], 'cover')).rejects.toThrow('403');
    expect((await lr.find('megadrive', ['Sonic the Hedgehog'], 'cover')).length).toBe(1);
  });
});
