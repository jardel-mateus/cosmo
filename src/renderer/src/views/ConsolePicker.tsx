import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { Glyph } from '../lib/input';
import { setSettings, useSettings } from '../lib/settings';
import { useSpatialNav } from '../lib/spatial';
import { initAudio, sfx } from '../lib/sfx';
import { plural } from '../lib/format';
import { CONSOLES, MAKERS, MAKER_LABEL } from '../stage/consoles';
import { tt } from '@shared/i18n';

const PICKABLE = CONSOLES.filter(c => c.id !== 'other');

export function ConsolePicker({ first, onClose }: { first: boolean; onClose: () => void }) {
  const s = useSettings();
  const trpc = useTRPC();

  const summary = useQuery(trpc.library.summary.queryOptions(undefined, { refetchInterval: q => (Object.keys(q.state.data?.perConsole ?? {}).length ? false : 2000) }));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(s.hidden));
  const root = useRef<HTMLDivElement>(null);

  const save = () => { initAudio(); sfx.play('ok'); setSettings({ hidden: PICKABLE.filter(c => hidden.has(c.id)).map(c => c.id), picked: true }); onClose(); };
  const toggle = (id: string) => { initAudio(); sfx.play('move'); setHidden(h => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const all = () => { initAudio(); sfx.play('move'); setHidden(new Set()); };

  const withGames = () => { initAudio(); sfx.play('move'); setHidden(new Set(PICKABLE.filter(c => !(summary.data?.perConsole[c.id]?.recomps)).map(c => c.id))); };

  useSpatialNav(root, {
    active: true, initial: '[data-main]',
    onKey: k => { if (k === 'Escape') { if (first) save(); else { sfx.play('back'); onClose(); } return true; } },
  });

  const shown = PICKABLE.length - hidden.size;
  return (
    <div className="ov">
      <div className="st-w cp-w" ref={root}>
        <header className="st-h">
          <span className="glow">{first ? tt('MONTE SEU PALCO') : tt('CONSOLES NO PALCO')}</span>
          <span className="st-hint"><Glyph a="ok" />{tt('mostrar/esconder')}{' '}<Glyph a="back" />{first ? 'pronto' : 'cancelar'}</span>
        </header>
        <div className="cp-body">
          <p className="cp-intro">{tt('Escolha quais consoles aparecem no palco. Os que ficarem de fora continuam no Cosmo: os jogos deles aparecem em')}{' '}<b>{tt('Outros')}</b>{tt(', separados por console. Dá para mudar quando quiser em Configurações.')}</p>
          {MAKERS.filter(m => m !== 'Outros').map(m => (
            <div key={m} className="cp-grp">
              <div className="st-sec">{MAKER_LABEL[m]}</div>
              <div className="cp-list">
                {PICKABLE.filter(c => c.maker === m).map((c, i) => {
                  const pc = summary.data?.perConsole[c.id], on = !hidden.has(c.id);
                  return (
                    <button key={c.id} className={`cp-c ${on ? 'on' : ''}`} data-hf data-main={m === 'Nintendo' && i === 0 ? true : undefined}
                      style={{ ['--cc' as string]: c.color }} aria-pressed={on} onClick={() => toggle(c.id)}>
                      <span className="cp-chk">{on ? '✓' : ''}</span>
                      <span className="cp-n">{c.name}</span>
                      <span className="cp-m">{pc?.recomps ? plural(pc.recomps, tt('jogo'), tt('jogos')) : tt('nenhum jogo ainda')}{pc?.installed ? tt(' · {0} seu{1}', { 0: pc.installed, 1: pc.installed > 1 ? 's' : '' }) : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <footer className="cp-foot">
          <button className="btn ghost" data-hf onClick={all}>{tt('Todos')}</button>
          <button className="btn ghost" data-hf onClick={withGames}>{tt('Só os que têm jogos')}</button>
          <span className="grow" />
          <span className="dim">{tt('{0} + Outros', { 0: plural(shown, tt('console'), tt('consoles')) })}</span>
          <button className="btn acc" data-hf onClick={save}>{first ? tt('PRONTO') : tt('SALVAR')}</button>
        </footer>
      </div>
    </div>
  );
}
