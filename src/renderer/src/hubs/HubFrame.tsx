import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { locale } from '../lib/format';

export function Fit({ w, h, className = '', style, children }: { w: number; h: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!; const fit = () => setS(Math.min(el.clientWidth / w, el.clientHeight / h));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [w, h]);
  return (
    <div ref={box} className="fit-box">
      <div className={className} style={{ ...style, width: w, height: h, transform: `translate(-50%, -50%) scale(${s})`, visibility: s ? 'visible' : 'hidden' }}>{children}</div>
    </div>
  );
}

export function BootOverlay({ kind, label = '' }: { kind: 'retro' | 'tiles' | 'soft' | 'sweep' | 'white'; label?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), 2000); return () => clearTimeout(t); }, []);
  return on ? <div className={`hboot hboot-${kind}`}><span>{kind === 'tiles' || kind === 'sweep' ? '' : label}</span></div> : null;
}

export function useHubToast() {
  const [msg, setMsg] = useState<{ t: string; k: number } | null>(null);
  const show = useCallback((t: string) => setMsg({ t, k: Date.now() }), []);
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(null), 2800); return () => clearTimeout(id); }, [msg]);
  const node = msg ? <div key={msg.k} className="stoast">{msg.t}</div> : null;
  return [node, show] as const;
}

export function useDeviceStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [batt, setBatt] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    addEventListener('online', on); addEventListener('offline', on);
    let b: { level: number; charging: boolean; addEventListener: (e: string, f: () => void) => void } | null = null;
    const nav = navigator as Navigator & { getBattery?: () => Promise<typeof b> };
    void nav.getBattery?.().then(x => {
      b = x; if (!b) return;
      const upd = () => setBatt(b!.charging && b!.level >= 0.999 ? null : { level: b!.level, charging: b!.charging });
      upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
    }).catch(() => {});
    return () => { removeEventListener('online', on); removeEventListener('offline', on); };
  }, []);
  return { online, batt };
}

export function useClock() {
  const f = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(f);
  useEffect(() => { const i = setInterval(() => setT(f()), 10_000); return () => clearInterval(i); }, []);
  return t;
}
