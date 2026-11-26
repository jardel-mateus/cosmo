/**
 * Simplifica as malhas dos modelos do palco que passam de TETO triângulos (os consoles aparecem pequenos;
 * alguns modelos tinham mais de 250 mil). Quando as faces vêm soltas e não dá para simplificar mantendo
 * as normais (caso do Switch 2), as normais são recalculadas depois.
 *
 * Uso (as dependências não ficam no projeto):
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer
 *   node scripts/simplificar-modelos.mjs src/renderer/public/models
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, normals, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TETO = 40000, ERRO = 0.01;
const dir = process.argv[2] ?? 'src/renderer/public/models';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const prims = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
const tris = doc => prims(doc).reduce((n, p) => n + ((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0);

for (const f of readdirSync(dir).filter(x => x.endsWith('.glb'))) {
  const path = join(dir, f);
  let doc = await io.read(path);
  const antes = tris(doc);
  if (antes <= TETO) continue;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: TETO / antes, error: ERRO, lockBorder: true }), dedup(), prune({ keepAttributes: true, keepLeaves: true }));
  if (tris(doc) > TETO * 1.5) {
    doc = await io.read(path);
    for (const p of prims(doc)) p.setAttribute('NORMAL', null);
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: TETO / antes, error: ERRO }), normals({ overwrite: true }), dedup(), prune({ keepAttributes: true }));
  }
  await io.write(path, doc);
  console.log(`${f.padEnd(36)} ${Math.round(antes)} → ${Math.round(tris(doc))} triângulos  (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
}
