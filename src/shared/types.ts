export const CONSOLE_IDS = ['nes', 'gb', 'snes', 'n64', 'gc', 'nds', 'wii', 'switch', 'switch2', 'ps1', 'ps2', 'psp', 'ps3', 'ps4', 'ps5', 'xbox', 'x360', 'megadrive', 'pc', 'other'] as const;
export type ConsoleId = (typeof CONSOLE_IDS)[number];

export type PlayStatus = 'full' | 'play' | 'wip';

export interface CatalogGame {
  id: string;
  title: string;
  repo: string | null;
  console: ConsoleId;
  platformName: string;
  status: PlayStatus;
  version: string | null;
  date: string | null;
  stars: number;
  year: number | null;
  developer: string | null;
  needs: string | null;
  description: string | null;
  coverUrl: string | null;

  noLink: boolean;
  firstSeenAt: number;
}

export type RadarKind = 'new' | 'up' | 'upd';
export interface RadarEvent { id: number; gameId: string; title: string; console: ConsoleId; kind: RadarKind; detail: string; at: number }

export type AchievementSource = 'xdbf' | 'builtin';
export interface AchievementView {
  id: number;
  name: string;
  description: string;
  points: number | null;
  unlockedAt: number | null;
  icon: string | null;
  /** Porcentagem de jogadores que desbloqueou (0 a 100), quando a origem publica. */
  rarity?: number | null;
}
export interface InstalledGame {
  id: string;
  title: string;
  console: ConsoleId;

  platformName: string | null;
  installDir: string;
  adapter: string | null;
  adapterLabel: string | null;
  catalogId: string | null;
  coverUrl: string | null;
  addedAt: number;
  /** complete: lista conhecida (não só as conquistas vistas) e todas desbloqueadas — o selo de 100%. */
  achievements: { unlocked: number; total: number; complete?: boolean } | null;

  exe: string | null;

  sourceRepo: string | null;

  version: string | null;

  managed: boolean;
  playMs: number;
  lastPlayed: number | null;
  running: boolean;
  missing: boolean;
  /** Desinstalado pelo Cosmo: continua na biblioteca com tempo de jogo e conquistas. */
  uninstalled: boolean;
}

export interface InstalledRelease { tag: string; assetId: number; date: string | null; uploader: string | null }
export interface UpdateInfo {
  repo: string | null;
  installed: string | null;
  latest: { tag: string; name: string; date: string | null; notes: string; page: string; size: number; assetName: string } | null;

  updateAvailable: boolean | null;
  checkedAt: number | null;
  error?: string;
}
export interface InstallProgress { key: string; stage: string; pct: number; done?: boolean; error?: string }
export interface PlayEvent { gameId: string; title: string; running: boolean; sessionMs?: number }
export interface PlayStats { totalMs: number; sessions: number; avgMs: number; lastPlayed: number | null; days: number[] }

export interface GameAchievements {
  game: InstalledGame;

  origin: string | null;

  unlockFile: string | null;

  errors: string[];
  list: AchievementView[];
  /** false quando não há a lista do jogo: só se sabe o que já foi desbloqueado. */
  complete: boolean;
}

/** Todas as conquistas de um jogo desbloqueadas (a lista é conhecida): a comemoração dos 100%. */
export interface CompleteEvent { gameId: string; gameTitle: string; console: ConsoleId; platformName: string | null; coverUrl: string | null; total: number; at: number }
export interface UnlockEvent { gameId: string; gameTitle: string; achId: number; name: string; at: number; description?: string; icon?: string | null; points?: number | null; /** % dos jogadores que têm (quando a origem publica). */ rarity?: number | null }

export interface RecentUnlock { gameId: string; gameTitle: string; achId: number; name: string; points: number | null; at: number; icon?: string | null }

export interface LibrarySummary {
  catalogTotal: number;
  platforms: number;
  perConsole: Record<string, { recomps: number; installed: number; fresh: number; platforms: number }>;
  installed: number;
  playMs: number;
  radar: { unseen: number; fresh: number; updates: number };
  achievements: { unlocked: number; total: number };
}
