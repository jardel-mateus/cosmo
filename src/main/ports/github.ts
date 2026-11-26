import { spawnSync } from 'node:child_process';
import { tt } from '@shared/i18n';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Asset { id: number; name: string; size: number; browser_download_url: string; url?: string; updated_at?: string; digest?: string | null; uploader?: { login?: string } | null }
interface ApiRelease { tag_name: string; name?: string | null; draft?: boolean; prerelease?: boolean; published_at?: string; body?: string | null; html_url?: string; assets: Asset[]; author?: { login?: string } | null }

export interface Release {
  tag: string; name: string; publishedAt: string | null;
  assetId: number; assetName: string; size: number; url: string; api: string | null;
  digest: string | null; notes: string; page: string; uploader: string | null; prerelease: boolean;
}

export class GitHubError extends Error { constructor(msg: string, readonly status?: number) { super(msg); } }

const UA = { 'User-Agent': 'Cosmo', Accept: 'application/vnd.github+json' };

export function parseRepo(input: string) {
  const text = String(input || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = text.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/);
  if (!m || m[2] === '.' || m[2] === '..') throw new GitHubError(tt('Use o formato dono/projeto, por exemplo hedge-dev/UnleashedRecomp.'));
  return `${m[1]}/${m[2]}`;
}

let token: string | null | undefined;
export function githubToken() {
  if (token !== undefined) return token;
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (!token) try {
    const r = spawnSync('gh', ['auth', 'token'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && /^[\w-]{20,}$/.test(r.stdout.trim())) token = r.stdout.trim();
  } catch { /* sem gh */ }
  return token;
}

export function guessAsset(assets: Asset[], platform: NodeJS.Platform = process.platform): Asset | null {
  const score = (a: Asset) => {
    const n = a.name.toLowerCase();
    if (/source|src\b|symbols|pdb|debug|[-_.]dbg[-_.]|libretro|\.sha\d*|\.sig$|\.asc$|\.txt$|\.json$/.test(n)) return -1;
    if (/arm64|aarch64|armv7|x86(?!_64)|i686|32bit|win32(?!-x64)/.test(n)) return -1;
    let v = 0;
    if (platform === 'win32') {
      if (!/\.(zip|7z|rar|exe)$/.test(n)) return -1;
      if (/(macos|mac|osx|darwin|linux|android|ios|appimage|flatpak)/.test(n)) return -1;
      if (/win|windows|msvc|mingw/.test(n)) v += 4;
      if (/x64|x86_64|amd64|win64/.test(n)) v += 2;
      if (/\.(zip|7z|rar)$/.test(n)) v += 2;
      if (/setup|install/.test(n)) v -= 3;
      if (/rog-?ally|steam-?deck|legacy/.test(n)) return -1;
      if (/no-?avx|no-?sse|compat|fallback|safe-?mode/.test(n)) v -= 3;
      if (/msvc|clang|mingw|llvm/.test(n)) v -= 0.5;
      if (/pgo/.test(n)) v += 1;
    } else if (platform === 'darwin') {
      if (/(windows|win64|win32|\.exe$|linux|appimage|android|\.deb$|\.rpm$|\.dmg$)/.test(n)) return -1;
      if (!/\.(zip|tar\.(gz|xz|zst|bz2)|tgz)$/.test(n)) return -1;
      if (/mac|macos|osx|darwin|apple/.test(n)) v += 5; else return -1;
      if (/universal/.test(n)) v += 2;
    } else {
      if (/(windows|win64|\.exe$|macos|osx|darwin|android)/.test(n)) return -1;
      if (/\.appimage$/.test(n)) v += 6;
      else if (/linux/.test(n) && /\.(tar\.(gz|xz|zst)|zip|7z)$/.test(n)) v += 3;
      else return -1;
      if (/x86_64|amd64|x64/.test(n)) v += 2;
    }
    return v;
  };
  const best = assets.map(a => [score(a), a] as const).filter(([v]) => v >= 0).sort((x, y) => y[0] - x[0])[0]?.[1] ?? null;
  return best ?? (platform === 'linux' ? guessAsset(assets, 'win32') : null);
}

export function createGitHub({ fetch = globalThis.fetch as Fetch, api = 'https://api.github.com', platform = process.platform as NodeJS.Platform } = {}) {
  async function json<T>(url: string): Promise<T> {
    const tk = url.startsWith('https://api.github.com/') ? githubToken() : null;
    const r = await fetch(url, { headers: tk ? { ...UA, Authorization: `Bearer ${tk}` } : UA, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      throw new GitHubError(
        r.status === 403 || r.status === 429 ? tt('O limite de consultas do GitHub acabou por agora. Tente de novo daqui a uma hora (ou faça login no GitHub CLI com "gh auth login").')
          : r.status === 404 ? tt('O GitHub não encontrou esse projeto (pode ter sido removido ou ficado privado).')
          : tt('O GitHub não respondeu (erro {0}). Tente mais tarde.', { 0: r.status }), r.status);
    }
    return r.json() as Promise<T>;
  }

  async function findRelease(repo: string, { asset: pattern, prerelease = false }: { asset?: string; prerelease?: boolean } = {}): Promise<Release> {
    const re = pattern ? new RegExp(pattern, 'i') : null;
    let list: ApiRelease[];
    if (prerelease) list = await json<ApiRelease[]>(`${api}/repos/${repo}/releases?per_page=15`);
    else {
      try { list = [await json<ApiRelease>(`${api}/repos/${repo}/releases/latest`)]; }
      catch (e) {
        if ((e as GitHubError).status !== 404) throw e;
        list = (await json<ApiRelease[]>(`${api}/repos/${repo}/releases?per_page=15`)).filter(r => !r.draft);
      }
      if (!list.length) throw new GitHubError(tt('{0} ainda não publicou nenhuma versão para baixar.', { 0: repo }));
    }
    for (const rel of list) {
      if (rel.draft) continue;
      const a = re ? rel.assets.find(x => re.test(x.name)) : guessAsset(rel.assets, platform);
      if (a) return {
        tag: rel.tag_name, name: rel.name || rel.tag_name, publishedAt: a.updated_at || rel.published_at || null,
        assetId: a.id, assetName: a.name, size: a.size, url: a.browser_download_url, api: a.url ?? null,
        digest: a.digest ?? null, notes: rel.body || '', page: rel.html_url || `https://github.com/${repo}/releases`,
        uploader: a.uploader?.login || rel.author?.login || null, prerelease: !!rel.prerelease,
      };
    }
    throw new GitHubError(tt('Nenhum download para {0} nas versões recentes de {1}.', { 0: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux', 1: repo }));
  }

  async function remoteZipNames(url: string): Promise<(string[] & { sizes: Map<string, number> }) | null> {
    try {
      const part = async (start: number, end: number) => {
        const r = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'], Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(20_000) });
        if (r.status !== 206) throw new Error(tt('sem pedaços'));
        return { bytes: Buffer.from(await r.arrayBuffer()), size: Number((r.headers.get('content-range') || '').split('/')[1]) };
      };
      const { size } = await part(0, 0);
      const tailLength = Math.min(size, 0xffff + 22);
      const { bytes: tail } = await part(size - tailLength, size - 1);
      const end = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
      if (end < 0) return null;
      let dirSize = tail.readUInt32LE(end + 12), dirStart = tail.readUInt32LE(end + 16);
      if (dirStart === 0xffffffff) {   // zip64
        const loc = tail.lastIndexOf(Buffer.from('PK\x06\x07', 'latin1'));
        if (loc < 0) return null;
        const at = Number(tail.readBigUInt64LE(loc + 8));
        const { bytes: z } = await part(at, at + 55);
        dirSize = Number(z.readBigUInt64LE(40)); dirStart = Number(z.readBigUInt64LE(48));
      }
      const { bytes: dir } = await part(dirStart, dirStart + dirSize - 1);
      const names = [] as unknown as string[] & { sizes: Map<string, number> };
      names.sizes = new Map();
      for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50;) {
        const n = dir.readUInt16LE(p + 28), name = dir.toString('utf8', p + 46, p + 46 + n);
        names.push(name); names.sizes.set(name, dir.readUInt32LE(p + 24));
        p += 46 + n + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
      }
      return names;
    } catch { return null; }
  }

  async function currentName(repo: string): Promise<string | null> {
    try { return (await json<{ full_name: string }>(`${api}/repos/${repo}`)).full_name; }
    catch (e) { if ((e as GitHubError).status === 404) return null; throw e; }
  }

  return { findRelease, remoteZipNames, currentName, fetch };
}
export type GitHub = ReturnType<typeof createGitHub>;
