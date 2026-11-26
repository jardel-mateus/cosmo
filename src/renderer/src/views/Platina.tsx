import { useEffect, useMemo, useRef } from 'react';
import type { CompleteEvent } from '@shared/types';
import { tt } from '@shared/i18n';
import { GameArt } from '../components/GameArt';
import { useKeys } from '../lib/input';
import { reduceMotion } from '../lib/settings';
import { sfx } from '../lib/sfx';

/** Comemoração dos 100%: capa dourada, "100%" grande e confete. Qualquer botão fecha; some sozinha em 8 s. */
export function Platina({ e, onClose }: { e: CompleteEvent; onClose: () => void }) {
  // Uma vez só, quando aparece (o onClose muda a cada render da tela de fora).
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    sfx.platinum();
    const t = window.setTimeout(() => close.current(), 8000);
    return () => clearTimeout(t);
  }, []);
  // No primeiro segundo os botões não fecham: o botão usado para voltar ao Cosmo (Home, o do controle) chegaria aqui.
  const t0 = useRef(performance.now());
  const ready = () => performance.now() - t0.current > 1000;
  useKeys(() => { if (ready()) close.current(); return true; });
  // Confete: posições e cores sorteadas uma vez (sem animação quando "reduzir movimento" está ligado).
  const bits = useMemo(() => reduceMotion() ? [] : Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 1.2, dur: 2.4 + Math.random() * 2.2, rot: Math.random() * 720 - 360,
    drift: Math.random() * 30 - 15, hue: [45, 50, 38, 330, 190][i % 5], w: 6 + Math.random() * 7,
  })), []);
  return (
    <div className="plat" onClick={() => { if (ready()) close.current(); }} role="dialog" aria-label={tt('100% das conquistas')}>
      <div className="plat-conf" aria-hidden>
        {bits.map((b, i) => (
          <i key={i} style={{ left: `${b.left}%`, width: b.w, height: b.w * 0.45, background: `hsl(${b.hue} 95% 60%)`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`,
            ['--rot' as string]: `${b.rot}deg`, ['--drift' as string]: `${b.drift}vw` }} />
        ))}
      </div>
      <div className="plat-box">
        <div className="plat-rays" aria-hidden />
        <div className="plat-cover"><GameArt title={e.gameTitle} console={e.console} platformName={e.platformName} fallback={e.coverUrl} variant="cover" done /></div>
        <div className="plat-txt">
          <div className="plat-k">{tt('JOGO COMPLETO')}</div>
          <div className="plat-pct">100%</div>
          <div className="plat-g">{e.gameTitle}</div>
          <div className="plat-n">{tt('Todas as {0} conquistas desbloqueadas', { 0: e.total })}</div>
        </div>
      </div>
    </div>
  );
}
