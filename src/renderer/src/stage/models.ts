/**
 * Carrega os modelos .glb do palco, dois por vez, começando pelos mais perto do console escolhido.
 * Cada arquivo é "arrumado" na hora (sem alterar o arquivo): tira chão/sombra que vem junto, esconde
 * peças que não são o console, corrige materiais transparentes e normaliza o tamanho.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { CONSOLES, stageSize, type StageConsole } from './consoles';

export interface StageModel { object: THREE.Object3D; mixer: THREE.AnimationMixer | null }

const loader = new GLTFLoader();
// As texturas vêm já no formato das placas de PC (KTX2 com BC7, compactado com zstd): na placa de vídeo
// ocupam 4x menos que uma imagem comum e não precisam de decodificador (scripts/comprimir-texturas.mjs).
// O KTX2Loader só precisa saber o que a placa aceita, então espera o palco criar o WebGL.
const ktx2 = new KTX2Loader();
let ktxReady!: () => void;
const ktxReadyP = new Promise<void>(r => { ktxReady = r; });
/** Placa sem BC7 (máquina virtual, driver antigo): as texturas sairiam pretas; sem elas o console fica na cor base. */
let semBc7 = false;
export function initStageLoader(gl: THREE.WebGLRenderer) {
  ktx2.detectSupport(gl); loader.setKTX2Loader(ktx2);
  semBc7 = !gl.extensions.has('EXT_texture_compression_bptc');
  if (semBc7) console.warn('[palco] a placa de vídeo não aceita texturas BC7: consoles sem textura');
  ktxReady();
}
const cache = new Map<string, Promise<StageModel>>();
const waiting = new Map<string, { resolve: (m: StageModel) => void; reject: (e: unknown) => void; tries: number }>();
let active = 0;
let focusIdx = 0;

/** Avisa qual console está selecionado (muda a prioridade da fila). */
export const setModelFocus = (id: string) => { focusIdx = Math.max(0, CONSOLES.findIndex(c => c.id === id)); };

const dist = (id: string) => {
  const n = CONSOLES.length, i = CONSOLES.findIndex(c => c.id === id);
  return Math.min((i - focusIdx + n) % n, (focusIdx - i + n) % n);
};

function pump() {
  while (active < 2 && waiting.size) {
    const id = [...waiting.keys()].sort((a, b) => dist(a) - dist(b))[0]!;
    const job = waiting.get(id)!; waiting.delete(id);
    const c = CONSOLES.find(x => x.id === id)!;
    active++;
    loadNow(c).then(job.resolve, e => {
      if (++job.tries < 3) setTimeout(() => { waiting.set(id, job); pump(); }, 1500 * job.tries);
      else job.reject(e);
    }).finally(() => { active--; pump(); });
  }
}

export function loadStageModel(c: StageConsole): Promise<StageModel> {
  let p = cache.get(c.id);
  if (!p) {
    p = new Promise((resolve, reject) => { waiting.set(c.id, { resolve, reject, tries: 0 }); });
    cache.set(c.id, p);
    queueMicrotask(pump);
  }
  return p;
}

async function loadNow(c: StageConsole): Promise<StageModel> {
  const [file, rotY, tiltX, emissive, minRough] = c.model;
  await ktxReadyP;
  const res = await loader.loadAsync(`models/${file}`);
  const o = res.scene; o.updateMatrixWorld(true);
  if (semBc7) o.traverse(x => {
    const m = x as THREE.Mesh; if (!m.isMesh) return;
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as unknown as Record<string, unknown>[])
      for (const [k, v] of Object.entries(mt)) if ((v as THREE.CompressedTexture)?.isCompressedTexture) {
        (v as THREE.Texture).dispose(); mt[k] = null; (mt as unknown as THREE.Material).needsUpdate = true;
        if (k === 'map') (mt as unknown as THREE.MeshStandardMaterial).color?.set('#6f6f7c');
        if (k === 'emissiveMap') (mt as unknown as THREE.MeshStandardMaterial).emissive?.set('#000000');
      }
  });
  const size = new THREE.Vector3();

  // chão/sombra que vem junto do arquivo
  const junk: THREE.Object3D[] = [];
  o.traverse(x => {
    if (!(x as THREE.Mesh).isMesh) return;
    const m = x as THREE.Mesh, mt = m.material as THREE.Material;
    if (/ground|floor|shadow|backdrop/i.test(m.name) || (mt?.transparent && new THREE.Box3().setFromObject(m).getSize(size).y < 1e-4)) junk.push(m);
  });
  junk.forEach(x => x.removeFromParent());

  if (c.hide) {
    const rm: THREE.Object3D[] = [];
    o.traverse(x => { const m = x as THREE.Mesh; if (m.isMesh && (c.hide!.test(m.name) || c.hide!.test((m.material as THREE.Material)?.name ?? ''))) rm.push(m); });
    rm.forEach(x => x.removeFromParent());
  }

  // Alguns exports marcam tudo como semitransparente: a ordem de desenho quebra e peças internas aparecem
  // através da carcaça. Peças opacas viram corte por alfa; "Invisible" some.
  o.traverse(x => {
    const m = x as THREE.Mesh; if (!m.isMesh) return;
    const ms = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    if (ms.some(mt => /invisible/i.test(mt.name))) { m.visible = false; return; }
    for (const mt of ms) {
      if (emissive !== undefined && mt.emissiveMap) mt.emissiveIntensity = emissive;
      if (minRough !== undefined && 'roughness' in mt) { mt.roughnessMap = null; mt.roughness = Math.max(mt.roughness, minRough); mt.metalness = Math.min(mt.metalness, 0.3); mt.needsUpdate = true; }
      if (mt.transparent && !/glass|vidro|clear|lens|scheibe/i.test(mt.name)) { mt.transparent = false; mt.depthWrite = true; mt.alphaTest = 0.5; mt.needsUpdate = true; }
    }
    m.frustumCulled = false;
  });

  o.rotation.set(tiltX, rotY, 0);
  const inner = new THREE.Group(); inner.add(o);
  let b = new THREE.Box3().setFromObject(inner); b.getSize(size);
  const flat = size.y / Math.max(size.x, size.z) < 0.3;
  inner.scale.setScalar(stageSize(c.cm, flat) / Math.max(size.x, size.y, size.z));
  b = new THREE.Box3().setFromObject(inner); const ct = b.getCenter(new THREE.Vector3());
  inner.position.set(-ct.x, -b.min.y, -ct.z);

  // ex.: a tela do fliperama com o Pac-Man
  let mixer: THREE.AnimationMixer | null = null;
  if (res.animations?.length) { mixer = new THREE.AnimationMixer(o); res.animations.forEach(a => mixer!.clipAction(a).play()); }

  // O clique acerta uma caixa invisível do tamanho do console, e não os milhares de triângulos do modelo.
  const root = new THREE.Group(); root.add(inner);
  const hb = new THREE.Box3().setFromObject(inner), hs = hb.getSize(new THREE.Vector3());
  const hit = new THREE.Mesh(new THREE.BoxGeometry(hs.x, hs.y, hs.z), new THREE.MeshBasicMaterial({ visible: false }));
  hb.getCenter(hit.position); root.add(hit);
  freeAfterUpload(inner);
  return { object: root, mixer };
}

/**
 * Depois que a geometria e as texturas vão para a placa de vídeo, a cópia na memória da tela não serve
 * mais: é solta (é a maior parte do que o palco ocupava). Por isso o modelo não pode ser montado de novo
 * num palco novo: releaseStageModels() faz recarregar do disco.
 */
function freeAfterUpload(o: THREE.Object3D) {
  const free = function (this: THREE.BufferAttribute) { (this as unknown as { array: null }).array = null; };
  const close = (t: THREE.Texture) => {
    (t.source.data as { close?: () => void } | null)?.close?.();
    if ((t as THREE.CompressedTexture).isCompressedTexture) (t as THREE.CompressedTexture).mipmaps = [];
  };
  o.traverse(x => {
    const m = x as THREE.Mesh; if (!m.isMesh) return;
    const g = m.geometry;
    g.computeBoundingBox(); g.computeBoundingSphere();
    for (const a of [...Object.values(g.attributes), g.index]) if (a && (a as THREE.BufferAttribute).isBufferAttribute) (a as THREE.BufferAttribute).onUpload(free);
    m.raycast = () => {};
    const ms = (Array.isArray(m.material) ? m.material : [m.material]) as unknown as Record<string, unknown>[];
    for (const mt of ms) for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.onUpdate = close;
  });
}

/** Solta os modelos carregados (palco desmontado ou contexto do WebGL perdido): o próximo palco recarrega do disco. */
export function releaseStageModels() {
  const old = [...cache.values()];
  cache.clear(); waiting.clear();
  for (const p of old) void p.then(m => m.object.traverse(x => {
    const mesh = x as THREE.Mesh; if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const mt of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as unknown as Record<string, unknown>[]) {
      for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
      (mt as unknown as THREE.Material).dispose();
    }
  }), () => {});
}
