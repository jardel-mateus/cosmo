import type { ComponentType } from 'react';
import type { ConsoleId } from '@shared/types';
import { HubParts } from '../lazy';

export interface HubProps { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }
export interface HubDef { component: ComponentType<HubProps>; hd: boolean }

// As telas são carregadas à parte (lazy.tsx): o registro só aponta para elas.
export const HUBS: Partial<Record<ConsoleId, HubDef>> = {
  switch: { component: HubParts.switch.C, hd: true },
  switch2: { component: HubParts.switch.C, hd: true },
  ps5: { component: HubParts.ps5.C, hd: true },
  ps4: { component: HubParts.ps4.C, hd: true },
  ps3: { component: HubParts.ps3.C, hd: true },
  psp: { component: HubParts.ps3.C, hd: true },
  x360: { component: HubParts.x360.C, hd: true },
  wii: { component: HubParts.wii.C, hd: true },
  snes: { component: HubParts.retro.C, hd: true },
  n64: { component: HubParts.retro.C, hd: true },
  ps1: { component: HubParts.retro.C, hd: true },
  gc: { component: HubParts.retro.C, hd: true },
  ps2: { component: HubParts.retro.C, hd: true },
  nes: { component: HubParts.retro.C, hd: true },
  megadrive: { component: HubParts.retro.C, hd: true },
  gb: { component: HubParts.retro.C, hd: true },
  nds: { component: HubParts.retro.C, hd: true },
  xbox: { component: HubParts.x360.C, hd: true },
  pc: { component: HubParts.pc.C, hd: true },
  other: { component: HubParts.retro.C, hd: true },
};
