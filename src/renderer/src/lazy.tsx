/**
 * Partes pesadas carregadas à parte, para a abertura aparecer logo: o palco 3D (three.js é metade do
 * código), as telas de cada console e as telas secundárias. preloadAll() começa a buscar tudo assim que
 * a abertura está na tela; durante a animação dá tempo de sobra, então nada espera depois.
 */
import { lazy, type ComponentType } from 'react';

type Loader<P> = () => Promise<ComponentType<P>>;
interface Part<P> { C: ComponentType<P>; load: () => Promise<unknown> }

function part<P>(load: Loader<P>): Part<P> {
  let p: Promise<ComponentType<P>> | null = null;
  const once = () => (p ??= load());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { C: lazy(() => once().then(c => ({ default: c as ComponentType<any> }))) as unknown as ComponentType<P>, load: once };
}

type Props<T> = T extends ComponentType<infer P> ? P : never;
const named = <M, K extends keyof M>(imp: () => Promise<M>, k: K) => part<Props<M[K]>>(() => imp().then(m => m[k] as unknown as ComponentType<Props<M[K]>>));

export const StagePart = named(() => import('./stage/Stage'), 'Stage');
export const SettingsPart = named(() => import('./views/Settings'), 'Settings');
export const AllGamesPart = named(() => import('./views/AllGames'), 'AllGames');
export const PickerPart = named(() => import('./views/ConsolePicker'), 'ConsolePicker');
export const ConsoleViewPart = named(() => import('./views/ConsoleView'), 'ConsoleView');
export const RadarPart = named(() => import('./views/Overlays'), 'RadarOverlay');
export const MePart = named(() => import('./views/Overlays'), 'MeOverlay');
export const SupportPart = named(() => import('./views/Overlays'), 'SupportOverlay');

export const HubParts = {
  switch: named(() => import('./hubs/Switch'), 'SwitchHub'),
  ps5: named(() => import('./hubs/PS5'), 'PS5Hub'),
  ps4: named(() => import('./hubs/PS4'), 'PS4Hub'),
  ps3: named(() => import('./hubs/PS3'), 'PS3Hub'),
  x360: named(() => import('./hubs/X360'), 'X360Hub'),
  wii: named(() => import('./hubs/Wii'), 'WiiHub'),
  retro: named(() => import('./hubs/Retro'), 'RetroHub'),
  pc: named(() => import('./hubs/PC'), 'PCHub'),
};

let started = false;
/** Busca tudo em sequência, palco primeiro (é o que aparece depois da abertura). */
export function preloadAll() {
  if (started) return; started = true;
  const rest = [SettingsPart, AllGamesPart, PickerPart, ConsoleViewPart, RadarPart, ...Object.values(HubParts)];
  void StagePart.load().catch(() => {}).then(async () => { for (const p of rest) await p.load().catch(() => {}); });
}
