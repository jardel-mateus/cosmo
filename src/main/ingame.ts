import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { app, BrowserWindow, desktopCapturer, type Display, ipcMain, nativeImage, type NativeImage, screen, shell } from 'electron';
import { type Binds, DEFAULT_BINDS, HOLD, padTokens } from '@shared/binds';
import { type Desk, moveTo, ownedBy, type Rect, type Win, xinputButtons } from './win32';
import { tt } from '@shared/i18n';
import { toDip } from './linux';
import { log } from './log';

export interface PadState { index: number; id: string; mapping: string; b: string }
export type Action = 'summon' | 'shot' | 'arm';

const PAD_PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script>
const { ipcRenderer } = require('electron');
let last = '';
setInterval(() => {
  const s = [...navigator.getGamepads()].filter(Boolean).map(p => ({ index: p.index, id: p.id, mapping: p.mapping, b: p.buttons.map(x => (x.pressed || x.value > 0.5 ? 1 : 0)).join('') }));
  const k = JSON.stringify(s);
  if (k !== last) { last = k; ipcRenderer.send('cartucho:pads', s); }
}, 16);
</script>`;

export const padKeys = (p: PadState) => padTokens(p, [...p.b].map(v => v === '1'));

export class Combos {
  private down = new Map<number, Set<string>>();
  private held = new Map<number, number>();

  constructor(private binds: (id: string) => Binds = () => DEFAULT_BINDS) {}

  feed(index: number, now: Set<string>, at = Date.now(), id = ''): Action[] {
    const b = this.binds(id), before = this.down.get(index) ?? now, out: Action[] = [];
    this.down.set(index, now);
    const has = (s: Set<string>, k: string[]) => k.length > 0 && k.every(x => s.has(x));
    const sNow = has(now, b.summon), extra = [...now].some(k => !b.summon.includes(k));
    const since = this.held.get(index);
    if (!sNow && since != null && since >= 0 && at - since >= HOLD && !has(now, b.shot)) out.push('summon');
    if (!sNow) this.held.delete(index);
    else if (extra) this.held.set(index, -1);
    else if (!has(before, b.summon)) this.held.set(index, at);
    if (has(now, b.shot) && !has(before, b.shot)) out.push('shot');
    else if (b.shot.length > 1) {
      const part = (k: Set<string>) => [...k].filter(x => b.shot.includes(x)).length;
      if (part(now) > part(before) && part(now) < b.shot.length) out.push('arm');
    }
    return [...out, ...this.tick(at)];
  }

  tick(at = Date.now()): Action[] {
    for (const [i, since] of this.held) {
      if (since >= 0 && at - since >= HOLD) { this.held.set(i, -1); return ['summon']; }
    }
    return [];
  }

  next(at = Date.now()) {
    const w = [...this.held.values()].filter(s => s >= 0).map(s => Math.max(0, s + HOLD - at));
    return w.length ? Math.min(...w) : null;
  }

  clear() { this.down.clear(); this.held.clear(); }
}

export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Jogo';
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
const sameRect = (a: Rect, b: Rect) => a.every((v, i) => v === b[i]);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const toastPage = (thumb: string, title: string, label: string, gold = false) => gold ? goldPage(title, label) : `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.t{position:absolute;inset:8px;display:flex;align-items:center;gap:14px;padding:10px 18px 10px 10px;border-radius:14px;background:rgba(14,8,26,.94);border:1px solid rgba(255,79,168,.6);box-shadow:0 10px 30px rgba(0,0,0,.5);color:#fff;animation:in .28s cubic-bezier(.2,.9,.3,1.2),out .3s ease-in 2.4s forwards}
img{height:76px;border-radius:8px;flex:none}
b{display:block;font-size:17px;color:#ff4fa8}
span{display:block;font-size:14px;opacity:.85;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
@keyframes in{from{transform:translateY(30px);opacity:0}}
@keyframes out{to{transform:translateY(20px);opacity:0}}
</style><div class="t">${thumb ? `<img src="data:image/jpeg;base64,${thumb}">` : ''}<div><b>${thumb ? '📷 ' : '⚠ '}${esc(label)}</b><span>${esc(title)}</span></div></div>`;

/** Aviso dos 100% por cima do jogo: dourado, com troféu e brilho passando. */
const goldPage = (title: string, label: string) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.t{position:absolute;inset:8px;display:flex;align-items:center;gap:16px;padding:12px 22px 12px 16px;border-radius:16px;overflow:hidden;
background:linear-gradient(135deg,#2a1a02,#120a00 60%,#2a1a02);border:2px solid #ffcf4a;box-shadow:0 0 24px rgba(255,190,40,.55),0 10px 30px rgba(0,0,0,.6);color:#fff;
animation:in .45s cubic-bezier(.2,.9,.3,1.3),out .4s ease-in 4.6s forwards}
.t::after{content:'';position:absolute;top:0;bottom:0;width:60px;left:-80px;background:linear-gradient(90deg,transparent,rgba(255,240,180,.55),transparent);transform:skewX(-20deg);animation:shine 1.6s ease-in-out .5s 2}
.tr{font-size:50px;line-height:1;filter:drop-shadow(0 0 10px rgba(255,200,60,.9));animation:pop .6s cubic-bezier(.2,.9,.3,1.6) .15s both}
b{display:block;font-size:20px;letter-spacing:1px;color:#ffcf4a}
span{display:block;font-size:15px;opacity:.9;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:330px}
@keyframes in{from{transform:translateY(40px) scale(.9);opacity:0}}
@keyframes out{to{transform:translateY(20px);opacity:0}}
@keyframes shine{to{left:110%}}
@keyframes pop{from{transform:scale(.2) rotate(-25deg);opacity:0}}
</style><div class="t"><div class="tr">🏆</div><div><b>${esc(label)}</b><span>${esc(title)}</span></div></div>`;

/** Conquista rara por cima do jogo: roxo e ciano, com o ícone da conquista e brilhos. */
export const rarePage = (name: string, label: string, icon: string | null) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.t{position:absolute;inset:8px;display:flex;align-items:center;gap:16px;padding:12px 22px 12px 12px;border-radius:16px;overflow:hidden;
background:linear-gradient(135deg,#1c0b3a,#0a0618 60%,#0b2133);border:2px solid #7ff3ff;box-shadow:0 0 26px rgba(150,110,255,.6),0 10px 30px rgba(0,0,0,.6);color:#fff;
animation:in .45s cubic-bezier(.2,.9,.3,1.3),out .4s ease-in 4.6s forwards}
.t::after{content:'';position:absolute;top:0;bottom:0;width:60px;left:-80px;background:linear-gradient(90deg,transparent,rgba(190,240,255,.5),transparent);transform:skewX(-20deg);animation:shine 1.6s ease-in-out .5s 2}
.ic{position:relative;width:76px;height:76px;flex:none;border-radius:12px;display:grid;place-items:center;font-size:44px;background:rgba(127,243,255,.12);box-shadow:0 0 0 2px #b48cff,0 0 18px rgba(180,140,255,.8);animation:pop .6s cubic-bezier(.2,.9,.3,1.6) .15s both}
.ic img{width:100%;height:100%;border-radius:12px;object-fit:cover}
.s{position:absolute;color:#bff8ff;font-size:16px;animation:tw 1.4s ease-in-out infinite;text-shadow:0 0 8px #7ff3ff}
b{display:block;font-size:16px;letter-spacing:.5px;white-space:nowrap;background:linear-gradient(90deg,#b48cff,#7ff3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
span.n{display:block;font-size:17px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}
@keyframes in{from{transform:translateY(40px) scale(.9);opacity:0}}
@keyframes out{to{transform:translateY(20px);opacity:0}}
@keyframes shine{to{left:110%}}
@keyframes pop{from{transform:scale(.2) rotate(-25deg);opacity:0}}
@keyframes tw{50%{opacity:.15;transform:scale(.6)}}
</style><div class="t"><div class="ic">${icon && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(icon) ? `<img src="${icon}">` : '💎'}<i class="s" style="left:-8px;top:-8px">✦</i><i class="s" style="right:-10px;top:20px;animation-delay:.5s">✦</i><i class="s" style="left:30px;bottom:-12px;animation-delay:.9s">✦</i></div><div><b>${esc(label)}</b><span class="n">${esc(name)}</span></div></div>`;

export interface InGameDeps {
  root: string;
  w32: Desk;
  current: () => { id: string; title: string } | null;
  reveal: () => void;
  refocus: () => void;
  minimize: () => void;
  own: () => number | null;
  visible: () => boolean;
  focused: () => boolean;
  sameScreen: () => boolean;
  dirsOf: (id: string) => string[];
  binds: (padId: string) => Binds;
}

export class InGame {
  readonly events = new EventEmitter<{ summon: [string]; shot: [{ title: string; file: string }] }>();
  private pad: BrowserWindow | null = null;
  private combos: Combos;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private game: number | null = null;
  private follow = 0;
  private seen = new Set<string>();
  private pre: Promise<{ file?: string; img?: NativeImage; at: number } | null> | null = null;
  private preAt = 0;
  private summonAt = 0;
  private summonTitle = '';

  constructor(private d: InGameDeps) {
    this.combos = new Combos(d.binds);
    ipcMain.on('cartucho:pads', (_e, list: PadState[]) => this.onPads(list));
  }

  get root() { return this.d.root; }

  private xid = '';
  private xon = false;
  private xseen = new Set<number>();

  private onXinput(slot: number, mask: number, mode: number, id?: string) {
    if (slot < 0) { log('XInput indisponível neste Windows: os atalhos usam só o leitor do Chromium'); this.xon = false; return; }
    this.xon = true;
    const pid = id ?? this.xid;
    if (mask < 0) { this.xseen.delete(slot); this.combos.feed(100 + slot, new Set(), Date.now(), pid); return; }
    if (!this.xseen.has(slot)) {
      this.xseen.add(slot);
      this.combos.feed(100 + slot, new Set(), Date.now(), pid);
      if (!id) log(`controle XInput ${slot + 1} lido direto pelo Windows`, mode === 3 ? '(sem o botão Xbox: XInput antigo)' : '');
    }
    this.run(this.combos.feed(100 + slot, padTokens({ id: pid, mapping: 'standard' }, xinputButtons(mask)), Date.now(), pid));
    this.schedule();
  }

  setActive(on: boolean) {
    if (on && !this.pad) {
      void this.d.w32.xinput((a, b, c, d) => this.onXinput(a, b, c, d)).then(ok => { if (!ok) log('não deu para ler o controle direto pelo sistema; os atalhos usam só o leitor do Chromium'); });
      if (process.platform === 'linux') { this.pad = null; return; }
      const a = screen.getPrimaryDisplay().workArea;
      this.pad = new BrowserWindow({
        width: 1, height: 1, x: a.x + a.width - 1, y: a.y + a.height - 1, frame: false, transparent: true, resizable: false, movable: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
      });
      this.pad.setIgnoreMouseEvents(true);
      this.pad.webContents.on('will-navigate', e => e.preventDefault());
      void this.pad.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAD_PAGE)}`);
      this.pad.once('ready-to-show', () => this.pad?.showInactive());
      this.pad.on('closed', () => { this.pad = null; });
    } else if (!on && this.pad) {
      this.pad.destroy();
      this.pad = null;
      this.combos.clear();
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  }

  onPads(list: PadState[]) {
    for (const p of list) {
      if (!this.seen.has(p.id)) { this.seen.add(p.id); log('controle visto:', p.id, p.mapping || 'genérico', `${p.b.length} botões`); }
      const xi = p.mapping === 'standard' && !/vendor:/i.test(p.id);
      if (xi) this.xid = p.id;
      if (this.xon && (xi || process.platform === 'linux')) continue;
      this.run(this.combos.feed(p.index, padKeys(p), Date.now(), p.id));
    }
    this.schedule();
  }

  private schedule() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const n = this.combos.next();
    if (n != null) this.timer = setTimeout(() => { this.timer = null; this.run(this.combos.tick()); this.schedule(); }, n + 5);
  }

  private run(actions: Action[]) {
    if (!actions.length) return;
    const late = actions.includes('shot') && Date.now() - this.summonAt < 4000;
    if (this.d.focused() && !late) { if (actions.includes('shot')) log('atalho de captura ignorado: o Cosmo está em foco'); return; }
    for (const a of actions) {
      if (a === 'summon') void this.summon();
      else if (a === 'arm') this.arm();
      else if (late) { log('atalho de captura completado depois de o Cosmo aparecer: captura e volta para o jogo'); void this.lateShot(); }
      else { log('atalho de captura apertado'); void this.capture(); }
    }
  }

  /** Atalhos fixos do teclado durante o jogo (Home e Print Screen). */
  fromKeyboard(a: 'summon' | 'shot') {
    if (this.d.focused()) return;
    if (a === 'summon') { log('Cosmo chamado pelo teclado (Home)'); void this.summon(); }
    else { log('captura pelo teclado (Print Screen)'); void this.capture(); }
  }

  private async lateShot() {
    if (this.pre) { await this.capture(true); await this.back(); return; }
    await this.back();
    await new Promise(r => setTimeout(r, 350));
    await this.capture(true);
  }

  private arm() {
    if (this.d.w32.early === false) return;
    const at = Date.now();
    if (this.pre && at - this.preAt < 300) return;
    void this.pre?.then(x => { if (x?.file) try { unlinkSync(x.file); } catch { } });
    this.preAt = at;
    const fail = (why: string) => { log('pré-captura falhou', why); return null; };
    if (this.d.w32.grab) { this.pre = this.d.w32.grab().then(img => (img && !img.isEmpty() ? { img, at } : fail(this.d.w32.err.trim().slice(-200))), e => fail(String(e))); return; }
    const file = join(app.getPath('temp'), `cartucho-pre-${process.pid}-${at}.png`);
    this.pre = this.d.w32.shot(file).then(r => (r && existsSync(file) ? { file, at } : fail(this.d.w32.err.trim().slice(-200))), e => fail(String(e)));
  }

  async summon() {
    this.summonAt = Date.now();
    const fg = await this.d.w32.foreground();
    if (fg && fg.pid !== process.pid) this.game = fg.hwnd;
    const title = this.d.current()?.title ?? (fg && fg.pid !== process.pid ? fg.title : '') ?? '';
    this.d.reveal();
    const own = this.d.own();
    const ok = own ? await this.d.w32.front(own) : null;
    this.d.refocus();
    this.summonTitle = title;
    log('Cosmo chamado pelo controle', title, ok === false ? '(sem foco)' : '');
    this.events.emit('summon', title);
  }

  private async gameWindow() {
    if (this.game) return this.game;
    const g = this.d.current(); if (!g) return null;
    const dirs = this.d.dirsOf(g.id);
    const w = (await this.d.w32.windows())?.find(x => x.pid !== process.pid && ownedBy(x, new Set(), dirs));
    return w?.hwnd ?? null;
  }

  async back() {
    const h = await this.gameWindow(), own = this.d.own();
    let same = true;
    if (h && own) {
      const [a, b] = await Promise.all([this.d.w32.monitor(h), this.d.w32.monitor(own)]);
      if (a && b) same = sameRect(a.m, b.m);
    }
    if (h) await this.d.w32.front(h);
    if (same || !h) this.d.minimize();
  }

  async place(dirs: string[], pid?: number) {
    const token = ++this.follow;
    if (!this.d.sameScreen() || screen.getAllDisplays().length < 2 || !this.d.visible()) return;
    const own = this.d.own(); if (!own) return;
    const target = await this.d.w32.monitor(own); if (!target) return;
    const pids = new Set(pid ? [pid] : []), moved = new Map<number, number>(), end = Date.now() + 45_000;
    const tick = async () => {
      if (token !== this.follow) return;
      for (const w of (await this.d.w32.windows()) ?? []) {
        if (w.pid === process.pid || !ownedBy(w, pids, dirs)) continue;
        const r = moveTo(w, target), n = moved.get(w.hwnd) ?? 0;
        if (!r || n >= 2) continue;
        moved.set(w.hwnd, n + 1);
        await this.d.w32.place(w.hwnd, r);
      }
      if (Date.now() < end) setTimeout(() => void tick(), 1000);
    };
    setTimeout(() => void tick(), 600);
  }

  folder(title: string) { return join(this.d.root, safeName(title)); }

  private async display(fg: Win | null): Promise<Display> {
    if (fg) {
      try {
        const [l, tp, r, b] = fg.m;
        const box = { x: l, y: tp, width: r - l, height: b - tp };
        return screen.getDisplayMatching(process.platform === 'linux' ? toDip(box) : screen.screenToDipRect(null, box));
      } catch { }
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  async capture(late = false) {
    if (this.busy) return null;
    this.busy = true;
    const pre = this.pre; this.pre = null;
    try {
      const fg = await this.d.w32.foreground();
      if (!late && fg && fg.pid === process.pid) { log('captura ignorada: o Cosmo está na frente'); return null; }
      const title = this.d.current()?.title || (late ? this.summonTitle : fg?.pid !== process.pid ? fg?.title?.trim() : '') || 'Cosmo';
      const dir = this.folder(title);
      mkdirSync(dir, { recursive: true });
      const base = stamp();
      let file = join(dir, `${base}.png`);
      for (let n = 2; existsSync(file); n++) file = join(dir, `${base} (${n}).png`);
      const d = await this.display(fg);
      let img: NativeImage | null = null;
      const early = pre ? await pre : null;
      if (early && Date.now() - early.at < 4500) {
        if (early.img) { writeFileSync(file, early.img.toPNG()); img = early.img; }
        else if (early.file) { copyFileSync(early.file, file); img = nativeImage.createFromPath(file); }
      }
      if (early?.file) try { unlinkSync(early.file); } catch { }
      if ((!img || img.isEmpty()) && await this.d.w32.shot(file) && existsSync(file)) img = nativeImage.createFromPath(file);
      if (!img || img.isEmpty()) {
        const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
        const src = sources.find(s => s.display_id === String(d.id)) ?? sources[0];
        if (!src || src.thumbnail.isEmpty()) throw new Error('nada para capturar');
        img = src.thumbnail;
        writeFileSync(file, img.toPNG());
      }
      this.toast(d, img, title, tt('Captura salva'));
      log('captura salva', file, early ? '(do instante do primeiro botão)' : '');
      this.events.emit('shot', { title, file });
      return file;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log('captura falhou', why, this.d.w32.err.trim().slice(-300));
      try { this.toast(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), null, why, tt('Não deu para capturar a tela')); } catch { }
      return null;
    } finally { this.busy = false; }
  }

  /** Fechou os 100% durante o jogo: o aviso dourado aparece por cima dele. */
  celebrate(title: string, label: string) {
    try { this.toast(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), null, title, label, true); } catch { }
  }

  /** Conquista rara destravada durante o jogo: aviso próprio por cima dele (as comuns não aparecem por cima). */
  rare(name: string, label: string, icon: string | null) {
    try { this.toast(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), null, name, label, true, rarePage(name, label, icon)); } catch { }
  }

  private toast(d: Display, img: NativeImage | null, title: string, label: string, gold = false, page?: string) {
    const W = gold ? 520 : 460, H = gold ? 120 : 112, a = d.workArea;
    const w = new BrowserWindow({
      width: W, height: H, x: Math.round(a.x + (a.width - W) / 2), y: a.y + a.height - H - 48, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    w.webContents.on('will-navigate', e => e.preventDefault());
    const thumb = img ? img.resize({ height: 152 }).toJPEG(80).toString('base64') : '';
    let shown = false;
    const show = () => {
      if (shown || w.isDestroyed()) return;
      shown = true;
      w.showInactive(); w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop();
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, gold ? 5200 : 3000);
    };
    w.once('ready-to-show', show);
    w.webContents.once('did-finish-load', () => setTimeout(show, 50));
    setTimeout(() => { if (!shown) { log('aviso da captura demorou para abrir'); show(); } }, 1500);
    void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page ?? toastPage(thumb, title, label, gold))}`);
    if (img) void this.d.w32.beep(this.shutter());
  }

  private shutterFile = '';
  private shutter() {
    if (this.shutterFile && existsSync(this.shutterFile)) return this.shutterFile;
    const rate = 22050, n = Math.round(rate * 0.16), data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / rate, noise = (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - t / 0.09), 3) * 0.45;
      const click = t > 0.06 && t < 0.15 ? Math.sin(2 * Math.PI * 2400 * t) * 0.12 * Math.max(0, 1 - (t - 0.06) / 0.09) : 0;
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, noise + click)) * 32767), i * 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    this.shutterFile = join(app.getPath('temp'), 'cartucho-shutter.wav');
    writeFileSync(this.shutterFile, Buffer.concat([head, data]));
    return this.shutterFile;
  }

  list(title: string) {
    const dir = this.folder(title);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f))
      .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
      .map(x => `media://shots/${encodeURIComponent(safeName(title))}/${encodeURIComponent(x.f)}`);
  }

  async remove(url: string) {
    const m = url.match(/^media:\/\/shots(\/.+)$/);
    const file = m ? this.resolve(m[1]!) : null;
    if (!file || !/\.(png|jpe?g)$/i.test(file) || !existsSync(file)) return false;
    try { await shell.trashItem(file); } catch { unlinkSync(file); }
    return true;
  }

  resolve(rel: string) {
    const full = resolve(this.d.root, ...rel.split('/').filter(Boolean).map(decodeURIComponent));
    const r = relative(this.d.root, full);
    return r && !r.startsWith('..') && !r.includes(`..${sep}`) ? full : null;
  }
}
