import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

export function steamManifest(...paths: (string | null | undefined)[]): { appid: string; name: string | null } | null {
  for (const p of paths) {
    const m = p?.match(/^(.*?[\\/]steamapps)[\\/]common[\\/]([^\\/]+)/i);
    if (!m) continue;
    const apps = m[1]!, folder = m[2]!.toLowerCase();
    let files: string[] = [];
    try { files = readdirSync(apps).filter(f => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
    for (const f of files) {
      let t = '';
      try { t = readFileSync(join(apps, f), 'utf8'); } catch { continue; }
      const dir = t.match(/"installdir"\s+"([^"]+)"/i)?.[1], id = t.match(/"appid"\s+"(\d+)"/i)?.[1];
      if (dir && id && dir.toLowerCase() === folder) return { appid: id, name: t.match(/"name"\s+"([^"]+)"/i)?.[1]?.trim() || null };
    }
  }
  return null;
}

export function windowsAppData(installDir: string, exe: string | null | undefined, gameId?: string, customPrefix?: string | null): string | null {
  if (!exe || !/\.exe$/i.test(exe)) return null;
  let user = ''; try { user = userInfo().username; } catch { }
  const roaming = (prefix: string, ...users: string[]) => users.map(u => join(prefix, 'drive_c', 'users', u, 'AppData', 'Roaming')).find(existsSync) ?? null;
  if (customPrefix) { const own = roaming(customPrefix, 'steamuser', user); if (own) return own; }
  if (gameId) { const own = roaming(join(prefixDir(gameId), 'pfx'), 'steamuser', user); if (own) return own; }
  const steam = steamManifest(installDir, exe);
  const lib = (exe.match(/^(.*?[\\/]steamapps)[\\/]/i) ?? installDir.match(/^(.*?[\\/]steamapps)[\\/]/i))?.[1];
  if (steam && lib) { const p = roaming(join(lib, 'compatdata', steam.appid, 'pfx'), 'steamuser'); if (p) return p; }
  return roaming(process.env.WINEPREFIX || join(homedir(), '.wine'), user);
}

export function steamRoots(home = homedir()) {
  return [join(home, '.local', 'share', 'Steam'), join(home, '.steam', 'steam'), join(home, '.steam', 'root'),
    join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'), join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')].filter(p => existsSync(p));
}

export function steamLibraries(root: string) {
  const out = new Set([join(root, 'steamapps')]);
  try {
    const t = readFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of t.matchAll(/"path"\s+"([^"]+)"/g)) out.add(join(m[1]!.replace(/\\\\/g, '\\'), 'steamapps'));
  } catch { }
  return [...out].filter(p => existsSync(p));
}

export const dataDir = (home = homedir(), env: NodeJS.ProcessEnv = process.env) => join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'Cosmo');
export const prefixDir = (gameId: string, home = homedir()) => join(dataDir(home), 'prefixos', gameId.replace(/[^\w-]/g, '_'));
