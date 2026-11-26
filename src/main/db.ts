import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE catalog_game (
    id TEXT PRIMARY KEY,            -- "entry" do Recompendium
    title TEXT NOT NULL,
    repo TEXT,
    console TEXT NOT NULL,
    platform_name TEXT NOT NULL,
    status TEXT NOT NULL,
    version TEXT,
    date TEXT,
    stars INTEGER NOT NULL DEFAULT 0,
    year INTEGER,
    developer TEXT,
    needs TEXT,
    description TEXT,
    cover_url TEXT,
    retired INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX catalog_game_console ON catalog_game(console);

  CREATE TABLE radar_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    kind TEXT NOT NULL,             -- new | up | upd
    detail TEXT NOT NULL,
    at INTEGER NOT NULL
  );

  CREATE TABLE installed_game (
    id TEXT PRIMARY KEY,
    catalog_id TEXT,
    title TEXT NOT NULL,
    console TEXT NOT NULL,
    install_dir TEXT NOT NULL,
    exe TEXT,
    version TEXT,
    adapter TEXT,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE play_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE achievement_def (
    game_id TEXT NOT NULL,
    ach_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    points INTEGER,
    image BLOB,
    sort INTEGER NOT NULL,
    PRIMARY KEY (game_id, ach_id)
  );

  CREATE TABLE achievement_unlock (
    game_id TEXT NOT NULL,
    ach_id INTEGER NOT NULL,
    unlocked_at INTEGER,            -- data gravada pelo jogo, quando ele grava
    seen_at INTEGER NOT NULL,       -- quando o Cosmo percebeu
    PRIMARY KEY (game_id, ach_id)
  );
  `,
  `
  ALTER TABLE catalog_game ADD COLUMN no_link INTEGER NOT NULL DEFAULT 0;
  UPDATE catalog_game SET retired = 0;
  `,
  `
  ALTER TABLE installed_game ADD COLUMN source_repo TEXT;          -- dono/projeto no GitHub, para atualizações
  ALTER TABLE installed_game ADD COLUMN release_json TEXT;         -- versão instalada: {tag, assetId, date, uploader}
  ALTER TABLE installed_game ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;   -- 1 = instalado pelo Cosmo
  ALTER TABLE installed_game ADD COLUMN manifest_json TEXT;        -- arquivos que vieram no download (para desinstalar)
  CREATE INDEX play_session_game ON play_session(game_id, started_at);
  `,
  `
  DELETE FROM kv WHERE key IN ('catalog.etag', 'catalog.lastModified');
  `,
  `
  CREATE TABLE game_info (key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);
  `,
  `
  ALTER TABLE radar_event ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE radar_event ADD COLUMN seen_at INTEGER;
  `,
  `
  ALTER TABLE installed_game ADD COLUMN uninstalled_at INTEGER;   -- desinstalado: fica na biblioteca com tempo e conquistas
  ALTER TABLE installed_game ADD COLUMN match_keys TEXT;           -- jeitos de reconhecer o jogo de novo: ["steam:123", "gog:9", "exe:jogo.exe"]
  ALTER TABLE installed_game ADD COLUMN hidden_at INTEGER;         -- tirado da biblioteca guardando o histórico (volta se instalar de novo)
  `,
];

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) tx(db, () => { db.exec(MIGRATIONS[v]!); db.exec(`PRAGMA user_version = ${v + 1}`); });
  return db;
}

export const kvGet = (db: DB, key: string) => (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
export const kvSet = (db: DB, key: string, value: string) => { db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };
