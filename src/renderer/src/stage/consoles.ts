import type { ConsoleId } from '@shared/types';
import { tt } from '@shared/i18n';

export type Maker = 'Nintendo' | 'Sony' | 'Microsoft' | 'Sega' | 'Vários' | 'Outros';
export interface StageConsole {
  id: ConsoleId; name: string; short: string; year: number | string; maker: Maker; color: string;
  model: [file: string, rotY: number, tiltX: number, emissive?: number, minRough?: number];
  hide?: RegExp;
  cm: number;
}

const PI = Math.PI;
export const CONSOLES: StageConsole[] = [
  { id: 'nes', name: 'NES', short: 'NES', year: 1983, maker: 'Nintendo', color: '#ff5a5a', cm: 25.4, model: ['nintendo_nes_original.glb', PI, 0] },
  { id: 'gb', name: 'Game Boy', short: 'GB', year: 1989, maker: 'Nintendo', color: '#a6d96a', cm: 14.8, model: ['game_boy_original.glb', 0, 0] },
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', year: 1990, maker: 'Nintendo', color: '#9b8cff', cm: 24, model: ['super_nintendo_game_console.glb', 0, 0] },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', year: 1996, maker: 'Nintendo', color: '#3fbf6a', cm: 26, model: ['nintendo_64.glb', 0, 0],
    hide: /controller|cartridge|joystick|button_controller|trigger|dpad|wire|plug_in|rubber_band|zbutton|abutton|bbutton/i },
  { id: 'gc', name: 'GameCube', short: 'GC', year: 2001, maker: 'Nintendo', color: '#7a5cff', cm: 16, model: ['gamecube_console.glb', 0, 0] },
  { id: 'nds', name: 'Nintendo DS', short: 'DS', year: 2004, maker: 'Nintendo', color: '#c9d2e3', cm: 13.3, model: ['nintendo_ds_lite.glb', 0, 0] },
  { id: 'wii', name: 'Wii', short: 'WII', year: 2006, maker: 'Nintendo', color: '#57d3ff', cm: 21.5, model: ['wii.glb', 0, 0] },
  { id: 'switch', name: 'Nintendo Switch', short: 'NSW', year: 2017, maker: 'Nintendo', color: '#ff4f5e', cm: 24, model: ['nintendo_switch.glb', 0, 1.1] },
  { id: 'switch2', name: 'Nintendo Switch 2', short: 'NS2', year: 2025, maker: 'Nintendo', color: '#ff7a45', cm: 27.2, model: ['nintendo_switch_2.glb', -PI / 2, 1.1] },
  { id: 'ps1', name: 'PlayStation', short: 'PS1', year: 1994, maker: 'Sony', color: '#c7bfe0', cm: 27, model: ['playstation_1.glb', 0, 0] },
  { id: 'ps2', name: 'PlayStation 2', short: 'PS2', year: 2000, maker: 'Sony', color: '#3d6bff', cm: 30, model: ['ps2_console.glb', -PI / 2, 0] },
  { id: 'psp', name: 'PSP', short: 'PSP', year: 2004, maker: 'Sony', color: '#c084fc', cm: 17, model: ['sony_psp.glb', 0, 0] },
  { id: 'ps3', name: 'PlayStation 3', short: 'PS3', year: 2006, maker: 'Sony', color: '#9a86e8', cm: 29, model: ['ps3_slim.glb', PI, 0] },
  { id: 'ps4', name: 'PlayStation 4', short: 'PS4', year: 2013, maker: 'Sony', color: '#4f8dff', cm: 30.5, model: ['playstation_4_original.glb', PI / 2, 0, 0.3, 0.6] },
  { id: 'ps5', name: 'PlayStation 5', short: 'PS5', year: 2020, maker: 'Sony', color: '#8fb6ff', cm: 39, model: ['playstation_5_digital_edition.glb', 0, 0] },
  { id: 'xbox', name: 'Xbox', short: 'XBOX', year: 2001, maker: 'Microsoft', color: '#2fd36b', cm: 32, model: ['xbox.glb', 0, 0] },
  { id: 'x360', name: 'Xbox 360', short: '360', year: 2005, maker: 'Microsoft', color: '#7fd13b', cm: 30.9, model: ['xbox_360_black.glb', 0, 0] },
  { id: 'megadrive', name: 'Mega Drive', short: 'MD', year: 1988, maker: 'Sega', color: '#3d7bff', cm: 28, model: ['sega_mega_drive.glb', 0, 0] },
  { id: 'pc', name: 'PC', short: 'PC', year: tt('source ports'), maker: 'Vários', color: '#4fe3d2', cm: 42, model: ['retro_crt_computer_1990s_desktop_pc.glb', -PI / 2, 0] },
  { id: 'other', name: 'Outros', short: '+', year: tt('várias plataformas'), maker: 'Outros', color: '#ffb43d', cm: 34, model: ['pacman_arcade.glb', 0, 0] },
];
export const MAKERS: Maker[] = ['Nintendo', 'Sony', 'Microsoft', 'Sega', 'Vários', 'Outros'];
export const MAKER_LABEL: Record<Maker, string> = { Nintendo: 'NINTENDO', Sony: 'SONY', Microsoft: 'MICROSOFT', Sega: 'SEGA', 'Vários': 'PC', Outros: tt('OUTROS') };
export const consoleIndex = (id: string) => Math.max(0, CONSOLES.findIndex(c => c.id === id));

export const visibleConsoles = (hidden: readonly string[]) => CONSOLES.filter(c => c.id === 'other' || !hidden.includes(c.id));
export const routeConsole = <T extends string>(id: T, hidden: readonly string[]): T | 'other' => (id !== 'other' && hidden.includes(id) ? 'other' : id);
export const otherConsoles = (hidden: readonly string[]) => ['other', ...hidden.filter(h => CONSOLES.some(c => c.id === h && c.id !== 'other'))];

export const stageSize = (cm: number, flat: boolean) => 2.3 * Math.pow(cm / 39, 0.35) * (flat ? 1.15 : 1);
