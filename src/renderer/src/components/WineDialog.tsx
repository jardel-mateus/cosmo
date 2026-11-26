import { useRef } from 'react';
import { Glyph, type Key } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { sfx } from '../lib/sfx';
import { stepFocused, WineOptions } from './WineOptions';
import { tt } from '@shared/i18n';

export function WineDialog({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, {
    active: true,
    onKey: (k: Key) => {
      if (k === 'Escape') { sfx.play('back'); onClose(); return true; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') return stepFocused(root.current, k === 'ArrowRight' ? 1 : -1);
    },
  });
  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-w">
        <header className="st-h"><span className="glow">{tt('WINE / PROTON')} · {title}</span><span className="st-hint"><Glyph a="ud" />{tt('escolher')}{' '}<Glyph a="lr" />{tt('mudar')}{' '}<Glyph a="back" />{tt('fechar')}</span></header>
        <div className="st-rows" ref={root}>
          <WineOptions id={id} />
        </div>
      </div>
    </div>
  );
}
