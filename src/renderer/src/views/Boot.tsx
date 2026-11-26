import { useEffect, useRef, useState } from 'react';
import type { LibrarySummary } from '@shared/types';
import { Glyph, PAD_NAMES, useKeys, usePadKind } from '../lib/input';
import { reduceMotion } from '../lib/settings';
import { initAudio, sfx } from '../lib/sfx';
import { fmtPlay, plural } from '../lib/format';
import { CONSOLES } from '../stage/consoles';
import { tt } from '@shared/i18n';

export function Boot({ summary, onDone }: { summary: LibrarySummary | undefined; onDone: () => void }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [skip, setSkip] = useState(false);
  const [shown, setShown] = useState(0);
  const pad = usePadKind();
  const timers = useRef<number[]>([]);
  const jingled = useRef(false);
  const snd = useRef<number[]>([]);

  const lines = summary ? [
    <>{tt('› catálogo:')}{' '}<b>{tt('{0} recomps', { 0: summary.catalogTotal })}</b>{' '}{tt('em {0} consoles', { 0: CONSOLES.length })}</>,
    <>{tt('› biblioteca:')}{' '}<b>{plural(summary.installed, tt('jogo instalado'), tt('jogos instalados'))}</b></>,
    <>{tt('› radar:')}{' '}<b>{plural(summary.radar.fresh, tt('novo'), tt('novos'))}</b>{' '}{tt('e {0} desde a última visita', { 0: plural(summary.radar.updates, tt('atualização'), tt('atualizações')) })}</>,
    <>{tt('› conquistas:')}{' '}<b>{summary.achievements.unlocked}</b>{' '}{tt('de {0}', { 0: summary.achievements.total })}{summary.playMs ? <>{' '}{tt('· tempo de jogo:')}{' '}<b>{fmtPlay(summary.playMs)}</b></> : null}</>,
    <>{tt('› controle:')}{' '}<b>{PAD_NAMES[pad]}</b></>,
  ] : [<>{tt('› lendo a biblioteca…')}</>];

  useEffect(() => {
    initAudio();
    if (reduceMotion()) { jingled.current = true; sfx.jingle(); return; }
    snd.current = [window.setTimeout(() => sfx.insert(), 1950), window.setTimeout(() => { jingled.current = true; sfx.jingle(); }, 2200)];
    return () => snd.current.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (stage !== 0 || skip) return;
    const reduce = reduceMotion(), base = reduce ? 0 : 3200;
    timers.current.forEach(clearTimeout); timers.current = [];
    for (let i = 0; i < lines.length; i++) timers.current.push(window.setTimeout(() => setShown(i + 1), reduce ? 0 : base + i * 260));
    timers.current.push(window.setTimeout(() => setStage(1), reduce ? 0 : base + lines.length * 260 + 200));
    return () => timers.current.forEach(clearTimeout);
  }, [lines.length, stage, skip]);

  const press = () => {
    if (stage === 0) { timers.current.forEach(clearTimeout); snd.current.forEach(clearTimeout); if (!jingled.current) sfx.jingle(); jingled.current = true; setSkip(true); setShown(lines.length); setStage(1); return; }
    if (stage !== 1) return;
    setStage(2); initAudio(); sfx.play('ok');
    window.setTimeout(onDone, reduceMotion() ? 0 : 460);
  };
  useKeys(() => press());

  return (
    <div id="boot" className={`${skip ? 'skip' : ''} ${stage === 2 ? 'go' : ''}`} onClick={press} aria-label={tt('Abertura do Cosmo')}>
      <div className="line" />
      <div className="bt-in">
        <div className="bt-dev">
          <div className="bt-orbit"><span className="stars" /><span className="bt-ring back" /><span className="bt-planet" /><span className="bt-ring" /><span className="bt-moon" /></div>
        </div>
        <div className="bt-logo">{tt('COSMO')}</div>
        <div className="bt-sub">{tt('RECOMPS · PORTS · EMULADORES')}</div>
        <div className="bt-log">{lines.slice(0, shown).map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className={`bt-start ${stage >= 1 ? 'on' : ''}`}>{stage >= 1 && <>{tt('APERTE')}{' '}<Glyph a="ok" />{' '}{tt('PARA COMEÇAR')}</>}</div>
      </div>
    </div>
  );
}
