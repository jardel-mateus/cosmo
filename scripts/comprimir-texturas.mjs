/**
 * Comprime as texturas dos modelos do palco para o formato que as placas de vídeo de PC usam (BC7, dentro de
 * KTX2 com zstd). Na placa de vídeo ocupam 4x menos que uma imagem PNG/JPEG aberta, com a mesma resolução.
 * Rode depois de otimizar-modelos.mjs e simplificar-modelos.mjs. Arquivos que já estão em KTX2 são pulados.
 *
 * Precisa do KTX-Software da Khronos (comando `ktx`, v4.3+) no PATH:
 *   https://github.com/KhronosGroup/KTX-Software/releases
 * e, sem ficar no projeto:
 *   npm i --no-save @gltf-transform/cli@4 @gltf-transform/core@4 @gltf-transform/extensions@4
 *   node scripts/comprimir-texturas.mjs src/renderer/public/models
 *
 * Passo 1: gltf-transform codifica em UASTC (sabe quais texturas são de cor e quais são lineares).
 * Passo 2: `ktx transcode` passa para BC7, que o Cosmo manda direto para a placa (sem decodificador no app).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'src/renderer/public/models';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), tmp = mkdtempSync(join(tmpdir(), 'texturas-'));
const cli = process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform';

for (const f of readdirSync(dir).filter(x => x.endsWith('.glb'))) {
  const path = join(dir, f);
  const antes = await io.read(path);
  const texs = antes.getRoot().listTextures();
  if (!texs.length || texs.every(t => t.getMimeType() === 'image/ktx2')) continue;
  execFileSync('npx', [cli.replace('.cmd', ''), 'uastc', path, path, '--level', '2', '--zstd', '18'], { stdio: 'ignore', shell: process.platform === 'win32' });
  const doc = await io.read(path);
  for (const [i, t] of doc.getRoot().listTextures().entries()) {
    if (t.getMimeType() !== 'image/ktx2') continue;
    const a = join(tmp, `${i}.ktx2`), b = join(tmp, `${i}-bc7.ktx2`);
    writeFileSync(a, t.getImage());
    execFileSync('ktx', ['transcode', '--target', 'bc7', '--zstd', '18', a, b]);
    t.setImage(new Uint8Array(readFileSync(b)));
  }
  await io.write(path, doc);
  console.log(`${f.padEnd(42)} ${texs.length} texturas em BC7  (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
}
