import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Artwork, imageType } from '../src/main/artwork/service';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex');
const semRede = (() => Promise.reject(new Error('sem rede'))) as never;
const file = (b: Buffer, name: string) => { const f = join(tmp(), name); writeFileSync(f, b); return f; };

describe('capa escolhida pelo jogador', () => {
  it('reconhece a imagem pelos bytes, não pela extensão', () => {
    expect(imageType(PNG)).toBe('png');
    expect(imageType(JPG)).toBe('jpg');
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageType(Buffer.from('GIF89a......'))).toBe('gif');
    expect(imageType(Buffer.from('MZ\x90\0 não é imagem'))).toBeNull();
  });

  it('troca a capa, aparece no lugar da baixada e volta para a original', async () => {
    const dir = tmp(), art = new Artwork(dir, semRede);
    let changed = 0; art.events.on('changed', () => changed++);
    expect(art.get('other', null, ['Meu Jogo']).custom).toBeUndefined();
    await art.setCover('other', 'Meu Jogo', file(PNG, 'capa.png'));
    const a = art.get('other', null, ['Meu Jogo']);
    expect(a.custom).toBe(true);
    expect(a.cover).toMatch(/^media:\/\/art\/_custom\/other\/meujogo\.png\?v=\d+$/);
    expect(art.resolve(new URL(a.cover!).pathname)).toBe(join(dir, '_custom', 'other', 'meujogo.png'));
    // Trocar de novo (outro formato) substitui a anterior.
    await art.setCover('other', 'Meu Jogo', file(JPG, 'outra.jpeg'));
    expect(readdirSync(join(dir, '_custom', 'other'))).toEqual(['meujogo.jpg']);
    await art.resetCover('other', 'Meu Jogo');
    expect(art.get('other', null, ['Meu Jogo'])).toEqual({});
    expect(existsSync(join(dir, '_custom', 'other', 'meujogo.jpg'))).toBe(false);
    await new Promise(r => setTimeout(r, 400));
    expect(changed).toBeGreaterThan(0);
  });

  it('vale por console e título: o mesmo nome em outro console mantém a capa dele', async () => {
    const art = new Artwork(tmp(), semRede);
    await art.setCover('ps2', 'Ico', file(PNG, 'ico.png'));
    expect(art.get('ps2', null, ['ICO']).custom).toBe(true);
    expect(art.get('ps3', null, ['ICO']).custom).toBeUndefined();
  });

  it('recusa o que não é imagem e nome de console estranho', async () => {
    const art = new Artwork(tmp(), semRede);
    await expect(art.setCover('other', 'X', file(Buffer.from('MZ programa'), 'x.png'))).rejects.toThrow(/não é uma imagem/);
    await expect(art.setCover('../fora', 'X', file(PNG, 'x.png'))).rejects.toThrow();
    expect(art.get('other', null, ['X']).custom).toBeUndefined();
  });
});
