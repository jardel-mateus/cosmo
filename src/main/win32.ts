import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import type { NativeImage } from 'electron';

export type Rect = [number, number, number, number];
export interface Win { hwnd: number; pid: number; path: string; title: string; r: Rect; m: Rect }
export interface Mon { m: Rect; w: Rect }
export type PadFeed = (slot: number, mask: number, mode: number, id?: string) => void;
export interface Desk {
  err: string;
  foreground(): Promise<Win | null>;
  windows(): Promise<Win[] | null>;
  monitor(hwnd: number): Promise<Mon | null>;
  place(hwnd: number, r: Rect): Promise<boolean | null>;
  front(hwnd: number): Promise<boolean | null>;
  shot(file: string): Promise<{ m: Rect } | null>;
  beep(file: string): Promise<boolean | null>;
  xinput(cb: PadFeed): Promise<boolean | null>;
  grab?(): Promise<NativeImage | null>;
  early?: boolean;
  stop(): void;
}

const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CartuchoWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct XPAD { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX, sThumbLY, sThumbRX, sThumbRY; }
  [StructLayout(LayoutKind.Sequential)] public struct XSTATE { public uint dwPacketNumber; public XPAD Gamepad; }
  [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern uint XGetEx14(uint i, out XSTATE s);
  [DllImport("xinput1_3.dll", EntryPoint = "#100")] static extern uint XGetEx13(uint i, out XSTATE s);
  [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")] static extern uint XGet910(uint i, out XSTATE s);
  static int xmode = 0;
  static System.Threading.Thread xthread;
  static readonly object outLock = new object();
  static System.IO.StreamWriter Out;

  public static void Init() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  static string R(RECT r) { return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }
  static string Q(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
  static MONITORINFO Mon(IntPtr h) { var i = new MONITORINFO(); i.cbSize = Marshal.SizeOf(typeof(MONITORINFO)); GetMonitorInfo(MonitorFromWindow(h, 2), ref i); return i; }
  static string PathOf(uint pid) {
    IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return "";
    try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(p, 0, sb, ref n) ? sb.ToString() : ""; } finally { CloseHandle(p); }
  }
  static string TitleOf(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  static string One(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid); RECT r; GetWindowRect(h, out r); var m = Mon(h);
    return "{\"hwnd\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"path\":" + Q(PathOf(pid)) + ",\"title\":" + Q(TitleOf(h)) + ",\"r\":" + R(r) + ",\"m\":" + R(m.rcMonitor) + "}";
  }
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
  static bool Front(IntPtr h) { System.Threading.Thread.Sleep(40); return GetForegroundWindow() == h; }
  static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    if (GetForegroundWindow() == h) return true;
    uint pid; uint ft = GetWindowThreadProcessId(GetForegroundWindow(), out pid), tt = GetWindowThreadProcessId(h, out pid), me = GetCurrentThreadId();
    bool a1 = ft != 0 && ft != me && AttachThreadInput(me, ft, true);
    bool a2 = tt != 0 && tt != me && tt != ft && AttachThreadInput(me, tt, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (a1) AttachThreadInput(me, ft, false);
    if (a2) AttachThreadInput(me, tt, false);
    if (Front(h)) return true;
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (Front(h)) return true;
    SwitchToThisWindow(h, true);
    return Front(h);
  }
  static string Beep(string path) { try { new System.Media.SoundPlayer(path).Play(); return "true"; } catch (Exception) { return "false"; } }
  static string Shot(string path) {
    var m = Mon(GetForegroundWindow()).rcMonitor;
    int w = m.R - m.L, hh = m.B - m.T;
    if (w <= 0 || hh <= 0) return "null";
    using (var bmp = new System.Drawing.Bitmap(w, hh))
    using (var g = System.Drawing.Graphics.FromImage(bmp)) {
      g.CopyFromScreen(m.L, m.T, 0, 0, new System.Drawing.Size(w, hh));
      bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
    return "{\"m\":" + R(m) + "}";
  }

  static uint XGet(uint i, out XSTATE s) {
    s = new XSTATE();
    if (xmode <= 1) { try { uint r = XGetEx14(i, out s); xmode = 1; return r; } catch (Exception) { xmode = 2; } }
    if (xmode == 2) { try { return XGetEx13(i, out s); } catch (Exception) { xmode = 3; } }
    if (xmode == 3) { try { return XGet910(i, out s); } catch (Exception) { xmode = -1; } }
    return 1167;
  }
  static void Write(string s) { lock (outLock) { Out.WriteLine(s); } }
  static void XLoop() {
    var last = new int[] { -1, -1, -1, -1 };
    var next = new int[4];
    while (true) {
      int now = Environment.TickCount;
      for (uint i = 0; i < 4; i++) {
        if (last[i] == -2 && now - next[i] < 0) continue;
        XSTATE s;
        uint rc = XGet(i, out s);
        if (xmode == -1) { Write("pad -1 0"); return; }
        if (rc != 0) { if (last[i] != -2) { last[i] = -2; Write("pad " + i + " -1"); } next[i] = now + 1000; continue; }
        int v = s.Gamepad.wButtons | (s.Gamepad.bLeftTrigger > 128 ? 0x10000 : 0) | (s.Gamepad.bRightTrigger > 128 ? 0x20000 : 0);
        if (v != last[i]) { last[i] = v; Write("pad " + i + " " + v + " " + xmode); }
      }
      System.Threading.Thread.Sleep(8);
    }
  }
  public static void Serve() {
    var utf8 = new UTF8Encoding(false);
    var input = new System.IO.StreamReader(Console.OpenStandardInput(), utf8);
    Out = new System.IO.StreamWriter(Console.OpenStandardOutput(), utf8);
    Out.AutoFlush = true;
    string l;
    while ((l = input.ReadLine()) != null) {
      int i = l.IndexOf(' ');
      if (i < 1) continue;
      string r;
      try { r = Run(l.Substring(i + 1)); } catch (Exception) { r = "null"; }
      Write(l.Substring(0, i) + " " + r);
    }
  }

  public static string Run(string line) {
    string[] a = line.Split(' ');
    switch (a[0]) {
      case "fg": { IntPtr h = GetForegroundWindow(); return h == IntPtr.Zero ? "null" : One(h); }
      case "wins": {
        var list = new List<string>();
        EnumWindows((h, l) => {
          if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
          RECT r; GetWindowRect(h, out r);
          if (r.R - r.L < 320 || r.B - r.T < 200) return true;
          list.Add(One(h)); return true;
        }, IntPtr.Zero);
        return "[" + string.Join(",", list) + "]";
      }
      case "mon": { var m = Mon(new IntPtr(long.Parse(a[1]))); return "{\"m\":" + R(m.rcMonitor) + ",\"w\":" + R(m.rcWork) + "}"; }
      case "place": {
        IntPtr h = new IntPtr(long.Parse(a[1])); int l = int.Parse(a[2]), t = int.Parse(a[3]), rr = int.Parse(a[4]), b = int.Parse(a[5]);
        if (IsIconic(h)) ShowWindow(h, 9);
        return SetWindowPos(h, IntPtr.Zero, l, t, rr - l, b - t, 0x0004 | 0x0010 | 0x4000) ? "true" : "false";
      }
      case "front": return Focus(new IntPtr(long.Parse(a[1]))) ? "true" : "false";
      case "shot": return Shot(line.Substring(5));
      case "beep": return Beep(line.Substring(5));
      case "xinput": {
        if (xthread == null) { xthread = new System.Threading.Thread(XLoop); xthread.IsBackground = true; xthread.Start(); }
        return "true";
      }
    }
    return "null";
  }
}
`;

const PS = `$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
${CS}
'@
[CartuchoWin]::Init()
[CartuchoWin]::Serve()
`;

export class Win32 implements Desk {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private wait = new Map<number, (v: unknown) => void>();
  private buf = '';
  private dead = 0;
  err = '';
  private onPad: PadFeed | null = null;

  constructor(private dir: string) {}

  private start() {
    if (process.platform !== 'win32') return null;
    if (this.ps) return this.ps;
    if (this.dead >= 3) return null;
    const file = join(this.dir, 'cartucho-win.ps1');
    try { writeFileSync(file, '﻿' + PS, 'utf8'); } catch { return null; }
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (d: string) => {
      this.buf += d;
      for (let i; (i = this.buf.indexOf('\n')) >= 0;) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (line.startsWith('pad ')) { const [, slot, mask, mode] = line.split(' ').map(Number); this.onPad?.(slot!, mask!, mode ?? 0); continue; }
        const sp = line.indexOf(' '); if (sp < 0) continue;
        const f = this.wait.get(Number(line.slice(0, sp))); if (!f) continue;
        this.wait.delete(Number(line.slice(0, sp)));
        try { f(JSON.parse(line.slice(sp + 1))); } catch { f(null); }
      }
    });
    ps.stderr.setEncoding('utf8');
    ps.stderr.on('data', (d: string) => { this.err = (this.err + d).slice(-2000); });
    const gone = () => { if (this.ps === ps && this.onPad) setTimeout(() => { if (!this.ps && this.onPad) void this.ask('xinput'); }, 2000); if (this.ps === ps) { this.ps = null; this.dead++; log('ajudante do Windows parou', this.err.trim().slice(-400)); } for (const f of this.wait.values()) f(null); this.wait.clear(); };
    ps.on('exit', gone);
    ps.on('error', gone);
    this.ps = ps;
    return ps;
  }

  private ask<T>(cmd: string, timeout = 8000): Promise<T | null> {
    const ps = this.start();
    if (!ps) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise(ok => {
      const t = setTimeout(() => { this.wait.delete(id); ok(null); }, timeout);
      this.wait.set(id, v => { clearTimeout(t); ok(v as T); });
      ps.stdin.write(`${id} ${cmd}\n`);
    });
  }

  warm() { void this.ask('fg', 20_000); }
  foreground() { return this.ask<Win>('fg'); }
  windows() { return this.ask<Win[]>('wins'); }
  monitor(hwnd: number) { return this.ask<Mon>(`mon ${Math.trunc(hwnd)}`); }
  place(hwnd: number, r: Rect) { return this.ask<boolean>(`place ${Math.trunc(hwnd)} ${r.map(Math.round).join(' ')}`); }
  front(hwnd: number) { return this.ask<boolean>(`front ${Math.trunc(hwnd)}`); }
  beep(file: string) { return this.ask<boolean>(`beep ${file.replace(/[\r\n]/g, '')}`); }
  shot(file: string) { return this.ask<{ m: Rect }>(`shot ${file.replace(/[\r\n]/g, '')}`, 15_000); }
  xinput(cb: PadFeed) { this.onPad = cb; return this.ask<boolean>('xinput', 20_000); }
  stop() { this.ps?.kill(); this.ps = null; }
}

const same = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) <= 2);

export function moveTo(w: Pick<Win, 'r' | 'm'>, target: Mon): Rect | null {
  if (same(w.m, target.m)) return null;
  if (same(w.r, w.m)) return [...target.m];
  const W = target.w[2] - target.w[0], H = target.w[3] - target.w[1];
  const ww = Math.min(w.r[2] - w.r[0], W), hh = Math.min(w.r[3] - w.r[1], H);
  const x = target.w[0] + Math.round((W - ww) / 2), y = target.w[1] + Math.round((H - hh) / 2);
  return [x, y, x + ww, y + hh];
}

export function ownedBy(w: Pick<Win, 'pid' | 'path'>, pids: Set<number>, dirs: string[]) {
  if (pids.has(w.pid)) return true;
  const k = (x: string) => x.replace(/[\\/]+/g, '/').toLowerCase().replace(/\/$/, '');
  const p = k(w.path);
  return !!p && dirs.filter(Boolean).some(d => p.startsWith(k(d) + '/'));
}

const XBITS: [number, number][] = [[0x0001, 12], [0x0002, 13], [0x0004, 14], [0x0008, 15], [0x0010, 9], [0x0020, 8], [0x0040, 10], [0x0080, 11], [0x0100, 4], [0x0200, 5], [0x0400, 16], [0x1000, 0], [0x2000, 1], [0x4000, 2], [0x8000, 3], [0x10000, 6], [0x20000, 7]];
export function xinputButtons(mask: number) {
  const out = Array<boolean>(17).fill(false);
  for (const [bit, i] of XBITS) if (mask & bit) out[i] = true;
  return out;
}
