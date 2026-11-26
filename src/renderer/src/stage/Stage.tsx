import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Palette } from '../lib/palettes';
import { stageSize, type StageConsole } from './consoles';
import { initStageLoader, loadStageModel, releaseStageModels, setModelFocus, type StageModel } from './models';
import { tt } from '@shared/i18n';

const PAD_Y = 0.026, PAD_TOP = PAD_Y + 0.04;
function geometry(n: number) {
  const R = Math.max(7.2, (Math.max(1, n) * 3.05) / (Math.PI * 2));
  return {
    R, STEP: (Math.PI * 2) / Math.max(1, n), RING_R: R + 1.32,
    CAM_HOME: new THREE.Vector3(0, 3.0, R + 8.8), CAM_ZOOM: new THREE.Vector3(0, 1.6, R + 3.2), LOOK: new THREE.Vector3(0, 0.6, R - 1.2),
  };
}
type Geo = ReturnType<typeof geometry>;

export type StageMode = 'stage' | 'behind' | 'hidden';
export interface Props {
  list: StageConsole[];
  sel: number;
  mode: StageMode;
  zoom: boolean;
  palette: Palette;
  pixel: boolean;
  onSelect: (i: number) => void;
  onEnter: (i: number) => void;
  /** Jogo aberto e o Cosmo em segundo plano: depois de um tempo o palco sai da placa de vídeo para liberar memória. */
  sleep?: boolean;
}

/** Quanto tempo de jogo aberto até soltar o palco (voltar rápido de um jogo não recarrega nada). */
const SLEEP_AFTER_MS = 20_000;

export function Stage(p: Props) {
  const [gen, setGen] = useState(0);
  const live = useRef<HTMLCanvasElement | null>(null);
  const retry = useRef(0);
  useEffect(() => () => { live.current = null; clearTimeout(retry.current); }, []);
  // Os modelos ficam guardados na memória do programa; o que sai é a cópia na placa de vídeo
  // (em placa integrada, isso também é RAM). Ao voltar, o palco é montado de novo na hora.
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (!p.sleep) { setAsleep(false); return; }
    const t = window.setTimeout(() => { live.current = null; clearTimeout(retry.current); setAsleep(true); setTimeout(releaseStageModels, 0); }, SLEEP_AFTER_MS);
    return () => clearTimeout(t);
  }, [p.sleep]);
  if (asleep) return <div className={`stage stage-${p.mode}`} />;
  return (
    <div className={`stage stage-${p.mode}`} onWheel={e => { if (p.mode === 'stage') p.onSelect(p.sel + (e.deltaY > 0 ? 1 : -1)); }}>
      <Canvas
        key={gen}
        onCreated={({ gl }) => {
          initStageLoader(gl);
          const el = gl.domElement;
          live.current = el;
          el.addEventListener('webglcontextlost', ev => {
            ev.preventDefault();
            if (live.current !== el) return;
            live.current = null;
            console.warn('[palco] contexto WebGL perdido, recriando');
            releaseStageModels();
            clearTimeout(retry.current);
            retry.current = window.setTimeout(() => setGen(g => g + 1), 1200);
          });
        }}
        flat
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 36, near: 0.1, far: 80, position: geometry(p.list.length).CAM_HOME.toArray() }}
        // A resolução vem daqui: o Canvas reaplica o dpr a cada render e desfazia o que o Scene ajustasse.
        dpr={p.pixel ? Math.min(1, 520 / Math.max(1, window.innerWidth)) : Math.min(2, window.devicePixelRatio || 1)}
        frameloop={p.mode === 'hidden' ? 'never' : 'always'}
        aria-label={tt('Consoles em 3D girando num palco')}
      >
        <Scene {...p} />
      </Canvas>
    </div>
  );
}

function Scene({ list, sel, mode, zoom, palette: P, pixel, onSelect, onEnter }: Props) {
  const { gl, scene, camera, size, setDpr } = useThree();
  const G = useMemo(() => geometry(list.length), [list.length]), { R, RING_R } = G;

  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.55;
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  useEffect(() => { scene.background = new THREE.Color(P.bg); scene.fog = new THREE.Fog(P.bg, 12, 26); }, [scene, P.bg]);

  useEffect(() => { setDpr(pixel ? Math.min(1, 520 / Math.max(1, size.width)) : Math.min(2, window.devicePixelRatio || 1)); }, [pixel, size.width, setDpr]);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera, w = size.width, h = size.height;
    cam.fov = w / h < 1.2 ? 50 : 36;
    cam.setViewOffset(w, h, 0, h * 0.13, w, h);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  const spot = useRef<THREE.SpotLight>(null!), rim = useRef<THREE.PointLight>(null!);
  const spotTarget = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0, R); return o; }, [R]);
  useEffect(() => {
    const col = new THREE.Color(list[sel]?.color ?? '#ffffff');
    spot.current.color.copy(col).lerp(new THREE.Color(0xffffff), 0.55);
    rim.current.color.copy(col);
  }, [sel, list]);

  return (
    <>
      <hemisphereLight args={[0x9a8cff, 0x140a24, 1.1]} />
      <directionalLight color={0xffe2b8} intensity={2.2} position={[3, 6, 9]} />
      <primitive object={spotTarget} />
      <spotLight ref={spot} intensity={34} distance={16} angle={Math.PI / 8} penumbra={0.5} decay={1.2} position={[0, 7, R + 0.8]} target={spotTarget} />
      <pointLight ref={rim} intensity={14} distance={8} decay={1.4} position={[0, 1.6, R - 1.6]} />

      <gridHelper key={P.id} args={[60, 60, P.pink, P.line]} position-y={-0.22} />
      <mesh position-y={-0.12}>
        <cylinderGeometry args={[R + 1.3, R + 1.4, 0.2, 64]} />
        <meshStandardMaterial color={P.panel} roughness={0.9} flatShading />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.017}>
        <ringGeometry args={[RING_R - 0.045, RING_R + 0.045, 160]} />
        <meshBasicMaterial color={P.acc} />
      </mesh>

      <Carousel list={list} G={G} sel={sel} mode={mode} zoom={zoom} padColor={P.line} onSelect={onSelect} onEnter={onEnter} />
    </>
  );
}

function Carousel({ list, G, sel, mode, zoom, padColor, onSelect, onEnter }: { list: StageConsole[]; G: Geo; sel: number; mode: StageMode; zoom: boolean; padColor: string; onSelect: (i: number) => void; onEnter: (i: number) => void }) {
  const { R, STEP, CAM_HOME, CAM_ZOOM, LOOK } = G;
  const carousel = useRef<THREE.Group>(null!);
  const wraps = useRef<(THREE.Group | null)[]>([]);
  const mixers = useRef(new Set<THREE.AnimationMixer>());
  const anim = useRef({ rotTarget: -sel * STEP, rotNow: -sel * STEP, zoom: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const { camera, gl } = useThree();
  // Arrastar com o mouse gira o palco; o console que passa na frente fica escolhido.
  const drag = useRef({ on: false, id: -1, x0: 0, rot0: 0, moved: false, lastX: 0, lastT: 0, vel: 0 });
  const live = useRef({ sel, mode, n: list.length, onSelect });
  live.current = { sel, mode, n: list.length, onSelect };

  useEffect(() => {
    const el = gl.domElement, d = drag.current;
    const PX = 190; // pixels para passar um console
    const idxOf = (rot: number) => { const n = live.current.n; return ((Math.round(-rot / STEP) % n) + n) % n; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || live.current.mode !== 'stage') return;
      d.on = true; d.id = e.pointerId; d.x0 = e.clientX; d.rot0 = anim.current.rotTarget; d.moved = false;
      d.lastX = e.clientX; d.lastT = performance.now(); d.vel = 0;
    };
    const move = (e: PointerEvent) => {
      if (!d.on || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 6) return;
      if (!d.moved) { d.moved = true; try { el.setPointerCapture(e.pointerId); } catch { } }
      el.style.cursor = 'grabbing';
      const now = performance.now(), dt = Math.max(1, now - d.lastT);
      d.vel = d.vel * 0.6 + ((e.clientX - d.lastX) / dt) * 0.4; d.lastX = e.clientX; d.lastT = now;
      const a = anim.current;
      a.rotTarget = d.rot0 + (dx / PX) * STEP;
      a.rotNow = a.rotNow + (a.rotTarget - a.rotNow) * 0.5;
      const i = idxOf(a.rotTarget);
      if (i !== live.current.sel) live.current.onSelect(i);
    };
    const up = (e: PointerEvent) => {
      if (!d.on || e.pointerId !== d.id) return;
      d.on = false;
      try { el.releasePointerCapture(e.pointerId); } catch { }
      if (!d.moved) return;
      el.style.cursor = '';
      const a = anim.current;
      const fling = Math.max(-3, Math.min(3, d.vel * 1.6)); // embalo do arrasto, até 3 consoles
      a.rotTarget = Math.round((a.rotTarget + (fling * STEP) / 2) / STEP) * STEP;
      const i = idxOf(a.rotTarget);
      if (i !== live.current.sel) live.current.onSelect(i);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [gl, STEP]);

  useEffect(() => {
    if (list[sel]) setModelFocus(list[sel]!.id);
    if (drag.current.on && drag.current.moved) return;
    const a = anim.current, base = -sel * STEP, TAU = Math.PI * 2;
    a.rotTarget = base + Math.round((a.rotTarget - base) / TAU) * TAU;
  }, [sel, STEP, list]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05), a = anim.current;
    mixers.current.forEach(m => m.update(dt));
    a.rotNow += (a.rotTarget - a.rotNow) * Math.min(1, dt * 6);
    carousel.current.rotation.y = a.rotNow;
    wraps.current.forEach((m, i) => {
      if (!m) return;
      const on = i === sel;
      if (on) m.rotation.y += dt * 0.6;
      else m.rotation.y += (Math.round(m.rotation.y / (Math.PI * 2)) * Math.PI * 2 - m.rotation.y) * Math.min(1, dt * 3);
      const s = on ? 1.0 : 0.82; m.scale.lerp(tmp.set(s, s, s), Math.min(1, dt * 6));
      const y = on ? PAD_TOP + 0.15 + Math.sin(state.clock.elapsedTime * 2) * 0.05 : PAD_TOP;
      m.position.y += (y - m.position.y) * Math.min(1, dt * 6);
    });
    a.zoom += ((zoom ? 1 : 0) - a.zoom) * Math.min(1, dt * 7);
    camera.position.lerpVectors(CAM_HOME, CAM_ZOOM, a.zoom);
    camera.lookAt(LOOK);
  });

  const click = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode !== 'stage' || drag.current.moved) return;
    if (i === sel) onEnter(i); else onSelect(i);
  };
  const hover = (on: boolean) => () => { if (mode === 'stage' && !drag.current.on) gl.domElement.style.cursor = on ? 'pointer' : ''; };

  return (
    <group ref={carousel}>
      {list.map((c, i) => {
        const ang = i * STEP;
        return (
          <group key={c.id} position={[Math.sin(ang) * R, 0, Math.cos(ang) * R]} rotation-y={ang} onClick={click(i)} onPointerOver={hover(true)} onPointerOut={hover(false)}>
            <group ref={el => { wraps.current[i] = el; }} position-y={PAD_TOP}>
              <ConsoleModel c={c} mixers={mixers.current} />
            </group>
            <mesh position-y={PAD_Y}>
              <cylinderGeometry args={[1.4, 1.5, 0.08, 6]} />
              <meshStandardMaterial color={padColor} roughness={0.55} metalness={0.08} flatShading />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ConsoleModel({ c, mixers }: { c: StageConsole; mixers: Set<THREE.AnimationMixer> }) {
  const [m, setM] = useState<StageModel | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadStageModel(c).then(x => { if (!alive) return; setM(x); if (x.mixer) mixers.add(x.mixer); }, e => { console.warn(`[palco] ${c.id}:`, e); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [c, mixers]);
  if (m) return <primitive object={m.object} />;
  return failed ? <GenericConsole c={c} /> : null;
}

function GenericConsole({ c }: { c: StageConsole }) {
  const w = stageSize(c.cm, true), h = w * 0.2, d = w * 0.72;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#1c1c22" roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh position={[0, h * 0.55, d / 2 + 0.002]}>
        <planeGeometry args={[w * 0.86, h * 0.08]} />
        <meshStandardMaterial color={c.color} emissive={c.color} emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0, h + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 0.94, d * 0.9]} />
        <meshStandardMaterial color="#26262e" roughness={0.6} />
      </mesh>
    </group>
  );
}
