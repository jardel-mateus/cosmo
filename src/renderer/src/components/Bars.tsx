const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
/** Horas por dia (o último é hoje), com as iniciais dos dias embaixo. */
export function Bars({ days }: { days: number[] }) {
  const max = Math.max(...days, 0.01), today = new Date().getDay(), n = days.length;
  return (
    <div className="bars-w">
      <div className="bars7" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {days.map((v, i) => <i key={i} className={v ? (i === n - 1 ? 't' : '') : 'z'} style={{ height: `${v ? Math.max(6, (v / max) * 100) : 4}%` }} title={`${v.toFixed(1)} h`} />)}
      </div>
      <div className="lb7" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>{days.map((_, i) => <span key={i}>{DOW[(today - (n - 1) + i + 70) % 7]}</span>)}</div>
    </div>
  );
}
