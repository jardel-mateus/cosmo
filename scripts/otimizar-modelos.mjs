/**
 * Encolhe as texturas dos modelos do palco 3D: os consoles aparecem pequenos na tela, e texturas de
 * 2048 ou 8192 pixels só gastam memória (cada uma vira dezenas de MB depois de aberta).
 * Regra: área até 512×512 (lado maior até 2048, para as faixas compridas); o formato (PNG/JPEG) e a geometria não mudam.
 *
 * Uso (as dependências não ficam no projeto):
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 sharp
 *   node scripts/otimizar-modelos.mjs src/renderer/public/models
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const MAX_SIDE = 2048, MAX_AREA = 512 * 512;
const dir = process.argv[2] ?? 'src/renderer/public/models';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let antes = 0, depois = 0;

for (const f of readdirSync(dir).filter(x => x.endsWith('.glb'))) {
  const path = join(dir, f);
  const doc = await io.read(path);
  let mudou = false, pxAntes = 0, pxDepois = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage(), size = tex.getSize();
    if (!img || !size || tex.getMimeType() === 'image/ktx2') continue; // já comprimida (comprimir-texturas.mjs)
    const [w, h] = size;
    const s = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
    pxAntes += w * h;
    if (s >= 1) { pxDepois += w * h; continue; }
    const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    let p = sharp(Buffer.from(img)).resize(nw, nh, { kernel: 'lanczos3' });
    p = tex.getMimeType() === 'image/jpeg' ? p.jpeg({ quality: 90, mozjpeg: true }) : p.png({ compressionLevel: 9 });
    tex.setImage(new Uint8Array(await p.toBuffer()));
    pxDepois += nw * nh;
    mudou = true;
  }
  const mb = (px) => (px * 4 * 1.33 / 1e6).toFixed(0);
  if (mudou) await io.write(path, doc);
  antes += pxAntes; depois += pxDepois;
  console.log(`${f.padEnd(42)} ${mb(pxAntes).padStart(4)} MB → ${mb(pxDepois).padStart(4)} MB na memória  (${(statSync(path).size / 1e6).toFixed(1)} MB no disco)`);
}
console.log(`\nTexturas abertas: ~${(antes * 4 * 1.33 / 1e6).toFixed(0)} MB → ~${(depois * 4 * 1.33 / 1e6).toFixed(0)} MB`);
