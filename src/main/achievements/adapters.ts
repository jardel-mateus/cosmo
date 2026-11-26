import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Xdbf } from './xdbf';
import { xdbfFromExecutable } from './xex';
import { readHedgeAch, readOxygenAchievements, readRsdkUserdata, type Unlock } from './saves';
import { SONIC3AIR } from './data/sonic3air';
import { SONIC1_2013, SONIC2_2013 } from './data/rsdk4';
import { tt } from '@shared/i18n';
import { steamEmu, steamLegit } from './steam';
import { gog } from './gog';
import { recompLocal } from './recomp';
import { recompia } from './recompia';
import { indiceAdapter } from './indice';

export interface AdapterContext {
  installDir: string;
  appData: string;
  title?: string;
  /** Repositório do GitHub do projeto (do jogo ou do catálogo), para o índice de conquistas. */
  repo?: string | null;
}
export interface AchievementDef { id: number; name: string; description: string; points: number | null; imageId?: number }
export interface Definitions { list: AchievementDef[]; images?: Map<number, Uint8Array>; origin: string }

export interface Adapter {
  id: string;
  label: string;

  repos: string[];

  detect(dir: string): boolean;
  definitions(ctx: AdapterContext): Promise<Definitions>;

  /** Arquivo de desbloqueios (vazio quando vem da internet). */
  unlockFile(ctx: AdapterContext): string;
  readUnlocks(buf: Uint8Array, ctx: AdapterContext): Unlock[];
  /** Outros arquivos que podem receber desbloqueios (observados todos). */
  watchFiles?(ctx: AdapterContext): string[];
  /** Desbloqueios que vêm da internet em vez de um arquivo. */
  remote?(ctx: AdapterContext): Promise<Unlock[]>;
  /** A lista pode crescer (ex.: mod atualizado): relê ao abrir o Cosmo. */
  refreshDefs?: boolean;
  /** Porcentagem de jogadores que desbloqueou cada conquista (0 a 100), quando a origem publica. */
  rarity?(ctx: AdapterContext): Promise<Map<number, number> | null>;
}

const hasFile = (dir: string, ...names: string[]) => names.some(n => existsSync(join(dir, n)));

async function xdbfDefinitions(paths: string[]): Promise<Definitions> {
  let lastErr: unknown = new Error(tt('executável do jogo não encontrado'));
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const x = new Xdbf(xdbfFromExecutable(new Uint8Array(await readFile(p))));
      const texts = x.achievementTexts();
      const images = new Map<number, Uint8Array>();
      for (const a of texts) { const img = x.image(a.imageId); if (img) images.set(a.id, img); }
      return { list: texts.map(a => ({ id: a.id, name: a.name, description: a.description, points: a.gamerscore, imageId: a.imageId })), images, origin: p };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const hedgeUserDir = (ctx: AdapterContext, folder: string) => existsSync(join(ctx.installDir, 'portable.txt')) ? ctx.installDir : join(ctx.appData, folder);

export const unleashedRecomp: Adapter = {
  id: 'unleashed-recomp',
  label: tt('UnleashedRecomp'),
  repos: ['unleashedrecomp'],
  detect: dir => hasFile(dir, 'UnleashedRecomp.exe', 'UnleashedRecomp'),
  definitions: ctx => xdbfDefinitions([join(ctx.installDir, 'patched', 'default.xex'), join(ctx.installDir, 'game', 'default.xex')]),
  unlockFile: ctx => join(hedgeUserDir(ctx, 'UnleashedRecomp'), 'save', 'ACH-DATA'),
  readUnlocks: readHedgeAch,
};

export const marathonRecomp: Adapter = {
  id: 'marathon-recomp',
  label: tt('MarathonRecomp'),
  repos: ['marathonrecomp'],
  detect: dir => hasFile(dir, 'MarathonRecomp.exe', 'MarathonRecomp'),
  definitions: ctx => xdbfDefinitions([join(ctx.installDir, 'decrypted', 'default.bin'), join(ctx.installDir, 'game', 'default.xex')]),
  unlockFile: ctx => join(hedgeUserDir(ctx, 'MarathonRecomp'), 'save', 'SonicNextAchievementData.bin'),
  readUnlocks: readHedgeAch,
};

export const sonic3air: Adapter = {
  id: 'sonic3air',
  label: tt('Sonic 3 A.I.R.'),
  repos: ['sonic3air'],
  detect: dir => hasFile(dir, 'Sonic3AIR.exe', 'sonic3air_linux', 'sonic3air'),
  definitions: async () => ({ list: SONIC3AIR.map(a => ({ ...a, points: null })), origin: tt('lista do próprio Sonic 3 A.I.R.') }),

  unlockFile: ctx => existsSync(join(ctx.installDir, 'savedata'))
    ? join(ctx.installDir, 'savedata', 'storage', 's3air_achievements.bin')
    : join(ctx.appData, 'Sonic3AIR', 'storage', 's3air_achievements.bin'),
  readUnlocks: readOxygenAchievements,
};

export const rsdkv4: Adapter = {
  id: 'rsdkv4',
  label: tt('Sonic 1/2 (2013)'),
  repos: ['rsdkv4-decompilation', 'sonic-1-2-2013-decompilation'],
  detect: dir => hasFile(dir, 'RSDKv4.exe', 'RSDKv4') && hasFile(dir, 'Data.rsdk'),

  definitions: async ctx => {
    const two = /sonic\s*(the\s*hedgehog\s*)?2\b|sonic 2/i.test(ctx.title ?? '');
    return { list: (two ? SONIC2_2013 : SONIC1_2013).map(a => ({ ...a, points: null })), origin: tt('lista do Retro Engine v4 ({0})', { 0: two ? 'Sonic 2' : 'Sonic 1' }) };
  },
  unlockFile: ctx => join(ctx.installDir, 'UData.bin'),
  readUnlocks: readRsdkUserdata,
};

export const ADAPTERS: Adapter[] = [unleashedRecomp, marathonRecomp, sonic3air, rsdkv4, steamLegit, gog, recompia, steamEmu, recompLocal, indiceAdapter];

export const adapterForRepo = (repo: string | null | undefined) => {
  const name = (repo ?? '').split('/').pop()?.toLowerCase() ?? '';
  return ADAPTERS.find(a => a.repos.includes(name)) ?? null;
};
export const adapterForDir = (dir: string) => ADAPTERS.find(a => a.detect(dir)) ?? null;
export const adapterById = (id: string | null | undefined) => ADAPTERS.find(a => a.id === id) ?? null;
