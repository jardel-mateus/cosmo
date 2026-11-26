import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/main/db';
import { AchievementService } from '../src/main/achievements/service';
import { createGitHub, guessAsset, parseRepo, type Asset } from '../src/main/ports/github';
import { Ports } from '../src/main/ports/installer';
import { listCatalog, listRadar, perConsole } from '../src/main/catalog';
import { FOLLOW, Player, type Proc } from '../src/main/play';
import { buildZip } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));
const sha = (b: Uint8Array) => 'sha256:' + createHash('sha256').update(b).digest('hex');

const files = new Map<string, Uint8Array>();
let releases: { tag: string; uploader: string; assets: { name: string; zip: Uint8Array; digest?: string }[] }[] = [];
let server: Server, base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    const json = (o: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const toApi = (r: typeof releases[number]) => ({
      tag_name: r.tag, name: r.tag, draft: false, prerelease: false, published_at: '2026-11-01T00:00:00Z', body: `notas ${r.tag}`, html_url: `${base}/rel/${r.tag}`,
      assets: r.assets.map((a, i) => ({ id: Number(r.tag.replace(/\D/g, '')) * 10 + i, name: a.name, size: a.zip.length, browser_download_url: `${base}/dl/${r.tag}/${a.name}`, digest: a.digest ?? sha(a.zip), uploader: { login: r.uploader } })),
    });
    if (url === '/repos/dono/MeuRecomp/releases/latest') return releases.length ? json(toApi(releases.at(-1)!)) : json({ message: 'Not Found' }, 404);
    if (url.startsWith('/repos/dono/MeuRecomp/releases')) return json(releases.map(toApi).reverse());
    const f = files.get(url);
    if (!f) return json({ message: 'Not Found' }, 404);
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    if (range) {
      const a = Number(range[1]), b = Math.min(Number(range[2]), f.length - 1);
      res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${f.length}`, 'content-length': b - a + 1 });
      return res.end(Buffer.from(f.subarray(a, b + 1)));
    }
    res.writeHead(200, { 'content-length': f.length }); res.end(Buffer.from(f));
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

function publish(tag: string, uploader: string, zipFiles: Record<string, string>, opts: { badDigest?: boolean } = {}) {
  const zip = buildZip(zipFiles), linux = buildZip({ 'meurecomp': 'linux' });
  files.set(`/dl/${tag}/MeuRecomp-windows-x64.zip`, zip);
  files.set(`/dl/${tag}/MeuRecomp-linux-x64.zip`, linux);
  releases.push({ tag, uploader, assets: [
    { name: 'MeuRecomp-linux-x64.zip', zip: linux },
    { name: 'MeuRecomp-windows-x64.zip', zip, digest: opts.badDigest ? 'sha256:' + '0'.repeat(64) : undefined },
  ] });
}

function setup() {
  const db = openDb(':memory:'), dir = tmp();
  db.prepare("INSERT INTO catalog_game (id, title, repo, console, platform_name, status, first_seen_at, updated_at) VALUES ('recomps/meu', 'Meu Jogo', 'dono/MeuRecomp', 'n64', 'Nintendo 64', 'full', 0, 0)").run();
  const ach = new AchievementService(db, tmp());
  const gh = createGitHub({ api: base, platform: 'win32' });
  const progress: string[] = [];
  const ports = new Ports(db, ach, gh, () => dir, () => false);
  ports.events.on('progress', p => progress.push(p.stage));
  return { db, ach, ports, dir, progress };
}

describe('escolha do download', () => {
  const a = (name: string): Asset => ({ id: 1, name, size: 1, browser_download_url: '' });
  it('prefere o zip de Windows x64', () => {
    const list = ['Source code.zip', 'Jogo-linux-x64.tar.gz', 'Jogo-Setup-x64.exe', 'Jogo-windows-x64.zip', 'Jogo-windows-arm64.zip', 'Jogo.pdb'].map(a);
    expect(guessAsset(list, 'win32')?.name).toBe('Jogo-windows-x64.zip');
    expect(guessAsset(list, 'linux')?.name).toBe('Jogo-linux-x64.tar.gz');
  });
  it('entende link do GitHub ou dono/projeto', () => {
    expect(parseRepo('https://github.com/hedge-dev/UnleashedRecomp/releases')).toBe('hedge-dev/UnleashedRecomp');
    expect(parseRepo('hedge-dev/UnleashedRecomp.git')).toBe('hedge-dev/UnleashedRecomp');
    expect(() => parseRepo('não é repo')).toThrow();
  });
});

describe('instalar, atualizar e desinstalar', () => {
  it('fluxo completo', async () => {
    releases = [];
    publish('v1', 'autor', { 'MeuRecomp/MeuRecomp.exe': 'exe v1', 'MeuRecomp/data/a.txt': 'a1', 'MeuRecomp/config.ini': 'padrao' });
    const { ach, ports, dir, progress } = setup();

    const names = await createGitHub({ api: base }).remoteZipNames(`${base}/dl/v1/MeuRecomp-windows-x64.zip`);
    expect(names).toContain('MeuRecomp/MeuRecomp.exe');

    const g = await ports.installFromCatalog('recomps/meu');
    expect(g).toMatchObject({ title: 'Meu Jogo', console: 'n64', managed: true, sourceRepo: 'dono/MeuRecomp', version: 'v1' });
    expect(g.installDir).toBe(join(dir, 'MeuRecomp'));
    expect(g.exe).toBe(join(dir, 'MeuRecomp', 'MeuRecomp.exe'));
    expect(readFileSync(g.exe!, 'utf8')).toBe('exe v1');
    expect(progress).toContain('Pronto');
    await expect(ports.installFromCatalog('recomps/meu')).rejects.toThrow(/já está/);

    expect(await ports.checkUpdate(g.id)).toMatchObject({ installed: 'v1', updateAvailable: false });

    writeFileSync(join(g.installDir, 'config.ini'), 'minha config');
    writeFileSync(join(g.installDir, 'save.dat'), 'meu save');

    publish('v2', 'estranho', { 'MeuRecomp/MeuRecomp.exe': 'exe v2', 'MeuRecomp/data/a.txt': 'a2', 'MeuRecomp/config.ini': 'padrao2' });
    expect(await ports.checkUpdate(g.id, true)).toMatchObject({ installed: 'v1', updateAvailable: true, latest: { tag: 'v2' } });
    await expect(ports.update(g.id)).rejects.toThrow(/outra conta/);

    releases.pop();
    publish('v3', 'autor', { 'MeuRecomp/MeuRecomp.exe': 'exe v3', 'MeuRecomp/data/a.txt': 'a3', 'MeuRecomp/config.ini': 'padrao3', 'MeuRecomp/data/b.txt': 'novo' });
    const up = await ports.update(g.id);
    expect(up).toMatchObject({ installed: 'v3', updateAvailable: false });
    expect(readFileSync(g.exe!, 'utf8')).toBe('exe v3');
    expect(readFileSync(join(g.installDir, 'config.ini'), 'utf8')).toBe('minha config');
    expect(readFileSync(join(g.installDir, '_cartucho-backup', 'v1', 'MeuRecomp.exe'), 'utf8')).toBe('exe v1');
    expect(ach.getGame(g.id).version).toBe('v3');

    const r = await ports.uninstall(g.id);
    expect(r.removed).toBeGreaterThan(0);
    expect(existsSync(g.exe!)).toBe(false);
    expect(readFileSync(join(g.installDir, 'save.dat'), 'utf8')).toBe('meu save');
    expect(readFileSync(join(g.installDir, 'config.ini'), 'utf8')).toBe('minha config');
    // Continua na biblioteca como não instalado, e instalar de novo reaproveita a mesma pasta e entrada (o save fica).
    expect(ach.listGames()).toEqual([expect.objectContaining({ id: g.id, missing: true, uninstalled: true })]);
    const again = await ports.install('dono/MeuRecomp', { catalogId: g.catalogId! });
    expect(again).toMatchObject({ id: g.id, installDir: g.installDir, missing: false, uninstalled: false });
    expect(readFileSync(join(g.installDir, 'save.dat'), 'utf8')).toBe('meu save');
  }, 15_000);

  it('pasta apagada por fora: o jogo fica como "não encontrado" e instalar de novo reaproveita a mesma entrada', async () => {
    releases = []; publish('v1', 'autor', { 'MeuRecomp/MeuRecomp.exe': 'exe v1' });
    const { db, ach, ports, dir } = setup();
    const g = await ports.installFromCatalog('recomps/meu');
    db.prepare('INSERT INTO play_session (game_id, started_at, ended_at) VALUES (?, 0, 60000)').run(g.id);
    rmSync(g.installDir, { recursive: true, force: true });
    expect(ach.getGame(g.id).missing).toBe(true);
    await expect(ports.update(g.id)).rejects.toThrow(/não existe mais/);
    const again = await ports.installFromCatalog('recomps/meu');
    expect(again.id).toBe(g.id);
    expect(again).toMatchObject({ missing: false, installDir: join(dir, 'MeuRecomp'), playMs: 60000, managed: true });
    expect(ach.listGames()).toHaveLength(1);

    rmSync(again.installDir, { recursive: true, force: true });
    const mine = tmp(); writeFileSync(join(mine, 'MeuRecomp.exe'), 'x');
    const moved = await ach.addGame(mine, { catalogId: 'recomps/meu' });
    expect(moved).toMatchObject({ id: g.id, installDir: mine, missing: false, exe: join(mine, 'MeuRecomp.exe') });
    expect(ach.listGames()).toHaveLength(1);
  });

  it('hash diferente do publicado: nada é instalado', async () => {
    releases = []; publish('v1', 'autor', { 'MeuRecomp.exe': 'x' }, { badDigest: true });
    const { ports, ach, dir } = setup();
    await expect(ports.installFromCatalog('recomps/meu')).rejects.toThrow(/hash/);
    expect(ach.listGames()).toEqual([]);
    expect(existsSync(join(dir, 'MeuRecomp'))).toBe(false);
  });

  it('pacote sem .exe (o jogo é montado por uma ferramenta): avisa antes de baixar', async () => {
    releases = []; publish('v1', 'autor', { 'tools/build.py': 'x', 'README.md': 'y' });
    const { ports } = setup();
    await expect(ports.installFromCatalog('recomps/meu')).rejects.toThrow(/não publica uma versão pronta/);
  });

  it('Switch e Switch 2: não baixa, não atualiza nem mostra o projeto; o usuário instala e adiciona a pasta', async () => {
    releases = []; publish('v1', 'autor', { 'MeuRecomp.exe': 'x' });
    const { db, ports, ach, dir } = setup();
    db.prepare("UPDATE catalog_game SET console = 'switch2'").run();
    await expect(ports.installFromCatalog('recomps/meu')).rejects.toThrow(/não baixa recomps deste console/);
    expect(existsSync(join(dir, 'MeuRecomp'))).toBe(false);
    const mine = tmp(); writeFileSync(join(mine, 'MeuRecomp.exe'), 'x');
    const g = await ach.addGame(mine, { catalogId: 'recomps/meu' });
    expect(g.catalogId).toBe('recomps/meu');
    expect(g.sourceRepo).toBeNull();
    expect(listCatalog(db, { console: 'switch2' })[0]!.repo).toBeNull();
    expect((await ports.checkUpdate(g.id)).latest).toBeNull();
    await expect(ports.update(g.id)).rejects.toThrow(/não atualiza recomps/);
  });

  it('Switch e Switch 2: vários projetos do mesmo jogo aparecem como um jogo só', async () => {
    const { db, ach } = setup();
    const add = db.prepare("INSERT INTO catalog_game (id, title, repo, console, platform_name, status, stars, first_seen_at, updated_at) VALUES (?, ?, ?, ?, 'x', ?, ?, 0, 0)");
    add.run('p/a', 'Pokemon Pokopia', 'a/a', 'switch2', 'wip', 5);
    add.run('p/b', 'Pokémon Pokopia', 'b/b', 'switch2', 'play', 1);
    add.run('p/c', 'Pokémon Pokopia', 'c/c', 'switch2', 'wip', 9);
    add.run('k/a', 'Mario Kart World', 'd/d', 'switch2', 'full', 0);
    add.run('n/a', 'Pokémon Pokopia', 'e/e', 'n64', 'wip', 0);
    db.prepare("INSERT INTO radar_event (game_id, kind, detail, at) VALUES ('p/a', 'new', 'a/a', 1), ('p/c', 'new', 'c/c', 2)").run();
    let sw2 = listCatalog(db, { console: 'switch2' });
    expect(sw2.map(g => g.title).sort()).toEqual(['Mario Kart World', 'Pokémon Pokopia']);
    expect(sw2.find(g => g.title.startsWith('Pok'))).toMatchObject({ id: 'p/b', status: 'play', repo: null });
    expect(listRadar(db).filter(e => e.console === 'switch2')).toHaveLength(1);
    expect(perConsole(db).switch2!.recomps).toBe(2);
    const mine = tmp(); writeFileSync(join(mine, 'Pokopia.exe'), 'x');
    await ach.addGame(mine, { catalogId: 'p/c' });
    sw2 = listCatalog(db, { console: 'switch2' });
    expect(sw2.find(g => g.title.startsWith('Pok'))!.id).toBe('p/c');
    expect(listCatalog(db, { console: 'n64' })).toHaveLength(2);
  });
});

describe.skipIf(process.platform === 'win32')('jogar e contar o tempo', () => {
  beforeAll(() => { Object.assign(FOLLOW, { every: 100, tries: 3 }); });
  it('abre, acompanha até fechar e soma a sessão', async () => {
    const db = openDb(':memory:'), dir = tmp();
    const exe = join(dir, 'jogo.sh');
    writeFileSync(exe, '#!/bin/sh\nsleep 0.4\n'); chmodSync(exe, 0o755);
    const ach = new AchievementService(db, tmp());
    const g = await ach.addGame(dir, { exe });
    const player = new Player(db, ach, async () => '');
    ach.isRunning = player.isRunning;
    const ended = new Promise<number>(ok => player.events.on('play', e => { if (!e.running) ok(e.sessionMs ?? 0); }));
    await player.play(g.id);
    expect(ach.getGame(g.id).running).toBe(true);
    await expect(player.play(g.id)).rejects.toThrow(/já está aberto/);
    expect(await ended).toBeGreaterThanOrEqual(300);
    const st = player.stats(g.id);
    expect(st.sessions).toBe(1);
    expect(st.totalMs).toBeGreaterThanOrEqual(300);
    expect(st.days).toHaveLength(14);
    expect(st.days[13]).toBeGreaterThan(0);
    expect(ach.getGame(g.id)).toMatchObject({ running: false, lastPlayed: expect.any(Number) });
    expect(ach.getGame(g.id).playMs).toBeGreaterThanOrEqual(300);
  });
  it('launcher que fecha logo: segue o jogo que ele abriu na mesma pasta', async () => {
    const db = openDb(':memory:'), dir = tmp();
    const exe = join(dir, 'launcher.sh');
    writeFileSync(exe, '#!/bin/sh\nsleep 0.1\n'); chmodSync(exe, 0o755);
    const ach = new AchievementService(db, tmp());
    const g = await ach.addGame(dir, { exe });
    let until = 0;
    const procs = async (): Promise<Proc[]> => (Date.now() < until ? [{ pid: 999_999, ppid: 1, path: join(dir, 'bin', 'Jogo.exe') }] : []);
    const player = new Player(db, ach, async () => '', () => {}, procs);
    ach.isRunning = player.isRunning;
    const ended = new Promise<number>(ok => player.events.on('play', e => { if (!e.running) ok(e.sessionMs ?? 0); }));
    until = Date.now() + 1500;
    await player.play(g.id);
    await new Promise(r => setTimeout(r, 700));
    expect(ach.getGame(g.id).running).toBe(true);
    expect(await ended).toBeGreaterThanOrEqual(1400);
    expect(player.stats(g.id)).toMatchObject({ sessions: 1 });
  });
  it('sem .exe conhecido: explica', async () => {
    const db = openDb(':memory:'), ach = new AchievementService(db, tmp());
    const g = await ach.addGame(tmp());
    await expect(new Player(db, ach, async () => '').play(g.id)).rejects.toThrow(/Escolher o .exe/);
  });
});

describe('verificação do Windows Defender', async () => {
  const { defenderVerdict } = await import('../src/main/ports/files');
  it('só acusa quando o Defender diz que achou ameaça', () => {
    expect(defenderVerdict(0, 'Scan starting...\r\nScan finished.\r\nScanning C:\\t\\a.zip found no threats.\r\n')).toBe('clean');
    expect(defenderVerdict(2, 'Scanning C:\\t\\a.zip found 1 threats.\r\n<===LIST OF DETECTED THREATS===>\r\nThreat                  : Virus:DOS/EICAR_Test_File\r\n')).toBe('threat');
    // Defender desligado ou trocado por outro antivírus: também sai com 2, mas não é ameaça.
    expect(defenderVerdict(2, 'CmdTool: Failed with hr = 0x800106BA. Check C:\\Users\\x\\AppData\\Local\\Temp\\MpCmdRun.log for more information')).toBe('skipped');
    expect(defenderVerdict(2, '')).toBe('skipped');
    expect(defenderVerdict(0, 'CmdTool: Failed with hr = 0x80508023.')).toBe('skipped');
  });
});
