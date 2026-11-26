import type { AchievementService } from './achievements/service';
import { type Artwork, looseKey } from './artwork/service';

interface Emu { re: RegExp; name: RegExp; consoles: string[] }

export const EMULATORS: Emu[] = [
  { re: /^duckstation/, name: /duckstation/i, consoles: ['ps1'] },
  { re: /^(epsxe|pcsx-redux)/, name: /epsxe|pcsx-redux/i, consoles: ['ps1'] },
  { re: /^pcsx2/, name: /pcsx2/i, consoles: ['ps2'] },
  { re: /^rpcs3/, name: /rpcs3/i, consoles: ['ps3'] },
  { re: /^ppsspp/, name: /ppsspp/i, consoles: ['psp'] },
  { re: /^dolphin/, name: /dolphin/i, consoles: ['gc', 'wii'] },
  { re: /^(project64|simple64|rmg|mupen64)/, name: /project ?64|simple64|rmg|rosalie|mupen64(plus)?/i, consoles: ['n64'] },
  { re: /^(snes9x|bsnes|higan)/, name: /snes9x|bsnes|higan/i, consoles: ['snes'] },
  { re: /^(fceux|nestopia)/, name: /fceux|nestopia/i, consoles: ['nes'] },
  { re: /^mesen/, name: /mesen ?2?/i, consoles: ['nes', 'snes', 'gb'] },
  { re: /^(sameboy|gambatte|bgb|mgba)/, name: /sameboy|gambatte|bgb|mgba/i, consoles: ['gb'] },
  { re: /^(melonds|desmume)/, name: /melonds|desmume/i, consoles: ['nds'] },
  { re: /^xemu/, name: /xemu/i, consoles: ['xbox'] },
  { re: /^xenia/, name: /xenia( canary)?/i, consoles: ['x360'] },
  { re: /^(kega|fusion|blastem|gens)/, name: /kega|fusion|blastem|gens/i, consoles: ['megadrive'] },
  { re: /^retroarch/, name: /retroarch/i, consoles: [] },
];

const CORES: [RegExp, string[]][] = [
  [/mupen|parallel n64/i, ['n64']], [/snes9x|bsnes/i, ['snes']], [/nestopia|fceumm|quicknes|mesen/i, ['nes']],
  [/genesis plus|picodrive|blastem/i, ['megadrive']], [/beetle psx|swanstation|duckstation|pcsx rearmed/i, ['ps1']],
  [/lrps2|pcsx2/i, ['ps2']], [/dolphin/i, ['gc', 'wii']], [/gambatte|sameboy|gearboy/i, ['gb']],
  [/melonds|desmume/i, ['nds']], [/ppsspp/i, ['psp']],
];

const fileName = (p: string) => (p.split(/[\\/]/).pop() ?? p).toLowerCase();
export const emulatorFor = (exe: string) => EMULATORS.find(e => e.re.test(fileName(exe))) ?? null;

const NOISE_WORD = /^(fps|vps|speed|vulkan|opengl|gl|direct3d|d3d\d*|dx\d*|metal|software|hardware|jit|jit64|jitarm64|dc|sc|hle|lle|interpreter|recompiler|cached|dynarec|cpu|gpu|ms|paused|pausado|running|executando|idle|booting|loading|version|versão|internal|native|resolution|x|\d+(\.\d+)?|\d+(\.\d+)?(fps|vps|ms|%|x|p))$/i;
const isNoise = (p: string) => p.split(/\s+/).every(w => NOISE_WORD.test(w.replace(/[:,]/g, '')));

export function parseTitle(title: string, emu: Emu): { name: string; consoles: string[] } | null {
  const consoles = emu.consoles.length ? emu.consoles : CORES.find(([re]) => re.test(title))?.[1] ?? [];
  if (!consoles.length) return null;
  const parts = title.split(/\s*\|\|?\s*|\s+[-–—•·]\s+|<[^>]*>/).map(p => p
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/^[A-Z]{4}[-_]?\d{5}\s*:\s*/, '')
    .replace(new RegExp(`(^|\\s)(${emu.name.source})(\\s|$)`, 'gi'), ' ')
    .replace(/\bv?\d+\.\d+[\w.+-]*/gi, ' ')
    .replace(/\b(fps|vps)\s*:?\s*[\d.]+|[\d.]+\s*(fps|vps|%)/gi, ' ')
    .replace(/\s+/g, ' ').trim());
  const good = parts.filter(p => /[a-z].*[a-z]/i.test(p) && !isNoise(p) && !CORES.some(([re]) => re.test(p) && p.split(' ').length <= 3));
  const name = good.sort((a, b) => b.length - a.length)[0];
  return name ? { name, consoles } : null;
}

export function createEmulatorResolver(ach: AchievementService, art: Artwork) {
  const cache = new Map<string, Promise<string | null>>();
  return (exe: string, title: string) => {
    const k = `${fileName(exe)}\u0000${title}`;
    let p = cache.get(k);
    if (!p) { p = resolve(exe, title).catch(() => null); cache.set(k, p); }
    return p.then(id => { if (!id) cache.delete(k); return id; });
  };

  async function resolve(exe: string, title: string): Promise<string | null> {
    const emu = emulatorFor(exe); if (!emu) return null;
    const got = parseTitle(title, emu); if (!got) return null;
    const key = looseKey(got.name); if (!key) return null;
    const mine = ach.listGames().find(g => got.consoles.includes(g.console) && looseKey(g.title) === key);
    if (mine) return mine.id;
    for (const c of got.consoles) {
      if (await art.knows(c, [got.name])) return ach.addEmulated({ title: got.name, console: c, exe }).id;
    }
    return null;
  }
}
