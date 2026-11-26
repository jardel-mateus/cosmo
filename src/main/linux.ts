import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, openSync, readdirSync, readFileSync, readlinkSync, type ReadStream, writeFileSync } from 'node:fs';
import { desktopCapturer, screen } from 'electron';
import { log } from './log';
import type { Desk, Mon, PadFeed, Rect, Win } from './win32';
import { Portal } from './portal';

const run = (cmd: string, args: string[], timeout = 3000) => new Promise<string | null>(ok => {
  execFile(cmd, args, { timeout, encoding: 'utf8' }, (e, out) => ok(e ? null : out));
});

const scaled = (r: Electron.Rectangle, k: number) => ({ x: Math.round(r.x * k), y: Math.round(r.y * k), width: Math.round(r.width * k), height: Math.round(r.height * k) });
export const toDip = (r: Electron.Rectangle) => (typeof screen.screenToDipRect === 'function' ? screen.screenToDipRect(null, r) : scaled(r, 1 / (screen.getPrimaryDisplay().scaleFactor || 1)));
const toPx = (r: Electron.Rectangle) => (typeof screen.dipToScreenRect === 'function' ? screen.dipToScreenRect(null, r) : scaled(r, screen.getPrimaryDisplay().scaleFactor || 1));

export const BTN_MASK: Record<number, number> = {
  0x130: 0x1000, 0x131: 0x2000, 0x133: 0x4000, 0x134: 0x8000, 0x136: 0x0100, 0x137: 0x0200, 0x138: 0x10000, 0x139: 0x20000,
  0x13a: 0x0020, 0x13b: 0x0010, 0x13c: 0x0400, 0x13d: 0x0040, 0x13e: 0x0080, 0x220: 0x0001, 0x221: 0x0002, 0x222: 0x0004, 0x223: 0x0008,
};

export function hasBit(caps: string, bit: number) {
  const words = caps.trim().split(/\s+/).reverse();
  const w = words[Math.floor(bit / 64)];
  if (!w) return false;
  return (BigInt(`0x${w}`) >> BigInt(bit % 64)) & 1n ? true : false;
}

export class PadState {
  mask = 0;
  private max = new Map<number, number>();
  constructor(readonly analogTriggers: boolean) {}

  event(type: number, code: number, value: number) {
    const before = this.mask;
    if (type === 1 && BTN_MASK[code]) this.mask = value ? this.mask | BTN_MASK[code]! : this.mask & ~BTN_MASK[code]!;
    else if (type === 3 && (code === 0x10 || code === 0x11)) {
      const [neg, pos] = code === 0x10 ? [0x0004, 0x0008] : [0x0001, 0x0002];
      this.mask &= ~(neg | pos);
      if (value < 0) this.mask |= neg; else if (value > 0) this.mask |= pos;
    } else if (type === 3 && this.analogTriggers && (code === 0x02 || code === 0x05)) {
      const m = Math.max(this.max.get(code) ?? 255, value); this.max.set(code, m);
      const bit = code === 0x02 ? 0x10000 : 0x20000;
      this.mask = value > m / 2 ? this.mask | bit : this.mask & ~bit;
    }
    return this.mask !== before;
  }
}

interface Dev { n: number; stream: ReadStream; state: PadState; id: string }

export class LinuxDesk implements Desk {
  err = '';
  private devs = new Map<string, Dev>();
  private timer: NodeJS.Timeout | null = null;
  private denied = false;
  private wayland = process.env.XDG_SESSION_TYPE === 'wayland';
  private tools = new Map<string, Promise<boolean>>();

  private portal = new Portal();
  grab?: () => Promise<Electron.NativeImage | null>;
  early = !this.wayland;

  constructor(private sys = process.env.CARTUCHO_INPUT_SYS || '/sys/class/input', private dev = process.env.CARTUCHO_INPUT_DEV || '/dev/input') {
    if (!this.wayland) this.grab = async () => (await this.capture())?.img ?? null;
  }

  private has(cmd: string) {
    let p = this.tools.get(cmd);
    if (!p) { p = run('which', [cmd]).then(x => !!x?.trim()); this.tools.set(cmd, p); }
    return p;
  }

  private monOf(r: Rect): Mon {
    const box = { x: r[0], y: r[1], width: Math.max(1, r[2] - r[0]), height: Math.max(1, r[3] - r[1]) };
    const d = screen.getDisplayMatching(toDip(box));
    const px = (x: Electron.Rectangle): Rect => { const q = toPx(x); return [q.x, q.y, q.x + q.width, q.y + q.height]; };
    return { m: px(d.bounds), w: px(d.workArea) };
  }

  async foreground(): Promise<Win | null> {
    if (!(await this.has('xdotool'))) return null;
    const id = (await run('xdotool', ['getactivewindow']))?.trim();
    if (!id || !/^\d+$/.test(id)) return null;
    const [pid, title, geo] = await Promise.all([run('xdotool', ['getwindowpid', id]), run('xdotool', ['getwindowname', id]), run('xdotool', ['getwindowgeometry', '--shell', id])]);
    const g = (k: string) => Number(geo?.match(new RegExp(`^${k}=(-?\\d+)`, 'm'))?.[1] ?? 0);
    const r: Rect = [g('X'), g('Y'), g('X') + g('WIDTH'), g('Y') + g('HEIGHT')];
    const p = Number(pid?.trim() || 0);
    let path = ''; try { path = p ? readlinkSync(`/proc/${p}/exe`) : ''; } catch { }
    return { hwnd: Number(id), pid: p, path, title: title?.trim() ?? '', r, m: this.monOf(r).m };
  }

  async windows(): Promise<Win[] | null> {
    if (!(await this.has('wmctrl'))) return null;
    const out = await run('wmctrl', ['-lpG']);
    if (out == null) return null;
    return parseWindows(out).map(w => {
      let path = ''; try { path = w.pid ? readlinkSync(`/proc/${w.pid}/exe`) : ''; } catch { }
      const r: Rect = [w.x, w.y, w.x + w.w, w.y + w.h];
      return { hwnd: w.id, pid: w.pid, path, title: w.title, r, m: this.monOf(r).m };
    }).filter(w => w.r[2] - w.r[0] >= 320 && w.r[3] - w.r[1] >= 200);
  }
  async monitor(hwnd: number): Promise<Mon | null> {
    if (!(await this.has('xdotool'))) return null;
    const geo = await run('xdotool', ['getwindowgeometry', '--shell', String(Math.trunc(hwnd))]);
    if (!geo) return null;
    const g = (k: string) => Number(geo.match(new RegExp(`^${k}=(-?\\d+)`, 'm'))?.[1] ?? 0);
    return this.monOf([g('X'), g('Y'), g('X') + g('WIDTH'), g('Y') + g('HEIGHT')]);
  }
  async place(hwnd: number, r: Rect) {
    if (!(await this.has('xdotool'))) return null;
    const id = String(Math.trunc(hwnd)), hex = `0x${Math.trunc(hwnd).toString(16)}`, wm = await this.has('wmctrl');
    const full = await this.isFull(hwnd);
    if (full && wm) await run('wmctrl', ['-i', '-r', hex, '-b', 'remove,fullscreen']);
    await run('xdotool', ['windowmove', id, String(r[0]), String(r[1])]);
    await run('xdotool', ['windowsize', id, String(r[2] - r[0]), String(r[3] - r[1])]);
    if (full && wm) await run('wmctrl', ['-i', '-r', hex, '-b', 'add,fullscreen']);
    return true;
  }

  private async isFull(hwnd: number) {
    return /_NET_WM_STATE_FULLSCREEN/.test((await run('xprop', ['-id', String(Math.trunc(hwnd)), '_NET_WM_STATE'])) ?? '');
  }

  async front(hwnd: number) {
    const id = String(Math.trunc(hwnd));
    if (await this.has('xdotool')) return (await run('xdotool', ['windowactivate', '--sync', id], 2500)) != null;
    if (await this.has('wmctrl')) return (await run('wmctrl', ['-i', '-a', `0x${Math.trunc(hwnd).toString(16)}`])) != null;
    return null;
  }

  private async capture() {
    if (this.wayland) { this.err = 'sessão Wayland: o sistema não deixa capturar a tela sem pedir'; return null; }
    const fg = await this.foreground();
    const d = fg ? screen.getDisplayMatching(toDip({ x: fg.r[0], y: fg.r[1], width: Math.max(1, fg.r[2] - fg.r[0]), height: Math.max(1, fg.r[3] - fg.r[1]) })) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find(s => s.display_id === String(d.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) { this.err = 'a captura da tela veio vazia'; return null; }
    const b = d.bounds;
    return { img: src.thumbnail, m: [b.x, b.y, b.x + b.width, b.y + b.height] as Rect };
  }

  async shot(file: string) {
    if (this.wayland) {
      const ok = await this.portal.screenshot(file);
      if (!ok) { this.err = this.portal.err; return null; }
      const b = screen.getPrimaryDisplay().bounds;
      return { m: [b.x, b.y, b.x + b.width, b.y + b.height] as Rect };
    }
    const c = await this.capture();
    if (!c) return null;
    writeFileSync(file, c.img.toPNG());
    return { m: c.m };
  }

  async beep(file: string) {
    for (const cmd of ['pw-play', 'paplay', 'aplay']) {
      if (!(await this.has(cmd))) continue;
      try { spawn(cmd, [file], { stdio: 'ignore', detached: true }).unref(); return true; } catch { }
    }
    return false;
  }

  async xinput(cb: PadFeed) {
    const scan = () => {
      let names: string[] = [];
      try { names = readdirSync(this.sys).filter(n => /^event\d+$/.test(n)); } catch { return; }
      const live = new Set<string>();
      for (const n of names) {
        const sys = `${this.sys}/${n}/device`;
        let caps = '';
        try { caps = readFileSync(`${sys}/capabilities/key`, 'utf8'); } catch { continue; }
        if (!hasBit(caps, 0x130)) continue;
        live.add(n);
        if (this.devs.has(n)) continue;
        const read = (f: string) => { try { return readFileSync(`${sys}/${f}`, 'utf8').trim(); } catch { return ''; } };
        const id = `${read('name') || 'Controle'} (STANDARD GAMEPAD Vendor: ${read('id/vendor')} Product: ${read('id/product')})`;
        const slot = Number(n.slice(5));
        let fd: number;
        try { fd = openSync(`${this.dev}/${n}`, 'r'); } catch (e) {
          if (!this.denied) { this.denied = true; log('sem permissão para ler o controle em /dev/input:', e instanceof Error ? e.message : e); }
          continue;
        }
        const state = new PadState(!hasBit(caps, 0x138));
        const stream = createReadStream('', { fd, highWaterMark: 24 * 64 });
        let rest = Buffer.alloc(0);
        stream.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.concat([rest, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
          let i = 0, changed = false;
          for (; i + 24 <= buf.length; i += 24) changed = state.event(buf.readUInt16LE(i + 16), buf.readUInt16LE(i + 18), buf.readInt32LE(i + 20)) || changed;
          rest = buf.subarray(i);
          if (changed) cb(slot, state.mask, 0, id);
        });
        const drop = () => { if (this.devs.get(n)?.stream === stream) { this.devs.delete(n); cb(slot, -1, 0, id); } };
        stream.on('error', drop); stream.on('close', drop);
        this.devs.set(n, { n: slot, stream, state, id });
        log('controle lido direto pelo Linux:', id);
      }
      for (const [n, d] of this.devs) if (!live.has(n)) { d.stream.destroy(); this.devs.delete(n); }
    };
    if (!existsSync(this.sys)) return false;
    scan();
    if (!this.timer) this.timer = setInterval(scan, 3000);
    return true;
  }

  stop() {
    this.portal.stop();
    if (this.timer) clearInterval(this.timer);
    for (const d of this.devs.values()) d.stream.destroy();
    this.devs.clear();
  }
}


export function parseWindows(out: string) {
  const L: { id: number; pid: number; x: number; y: number; w: number; h: number; title: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const f = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/i);
    if (!f || f[2] === '-1') continue;
    L.push({ id: parseInt(f[1]!, 16), pid: Number(f[3]), x: Number(f[4]), y: Number(f[5]), w: Number(f[6]), h: Number(f[7]), title: f[8]!.trim() });
  }
  return L;
}
