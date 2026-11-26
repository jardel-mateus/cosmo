import type { InstallProgress } from '@shared/types';
export function ProgressBar({ p }: { p: InstallProgress }) {
  if (p.error) return <p className="err" style={{ margin: 0 }}>{p.error}</p>;
  return (
    <div className="dl">
      <div className="dl-t">{p.stage}{p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}</div>
      <div className={`pbar ${p.pct >= 1 && !p.done ? 'busy' : ''}`}><i style={{ width: `${Math.round((p.pct || 0.02) * 100)}%` }} /></div>
    </div>
  );
}
