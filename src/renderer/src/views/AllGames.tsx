import { useEffect, useMemo, useState } from 'react';
import { CONSOLE_NAME, isSelfInstall } from '@shared/consoles';
import { sfx } from '../lib/sfx';
import { plural } from '../lib/format';
import { Discover, initialDiscover } from '../components/Discover';
import { GameView } from '../components/GameView';
import { Fit, useHubToast } from '../hubs/HubFrame';
import { useHubData, type HubGame } from '../hubs/data';
import { useGameMenu } from '../hubs/menu';
import { tt } from '@shared/i18n';

const groupOf = (g: HubGame) => (g.console === 'other' ? g.platformName ?? tt('Outros') : CONSOLE_NAME[g.console]);

export function AllGames({ onBack }: { onBack: () => void }) {
  const data = useHubData(null);
  const [st, set] = useState(initialDiscover);
  const [game, setGame] = useState<string | null>(null);
  const [toast, show] = useHubToast();
  const menu = useGameMenu({ show, onInfo: x => { sfx.play('ok'); setGame(x.key); }, onRemoved: () => setGame(null) });
  useEffect(() => { if (menu.error) { show(menu.error); menu.reset(); } }, [menu.error]);
  const extra = useMemo(() => data.lib.filter(x => !x.catalog), [data.lib]);
  const lookup = useMemo(() => new Map([...data.lib, ...data.catalog].map(x => [x.key, x] as const)), [data.lib, data.catalog]);
  const g = game ? lookup.get(game) ?? null : null;
  const consoles = new Set([...data.catalog, ...extra].map(groupOf)).size;

  return (
    <section className="view hub sk-all">
      <Fit w={1920} h={1080} className="all-g">
        <Discover theme="d-app" title={tt('Todos os jogos')} cname={`${plural(consoles, tt('plataforma'), tt('plataformas'))} · ${plural(data.catalog.length + extra.length, tt('jogo'), tt('jogos'))}`}
          games={data.catalog} extra={extra} self={false} st={st} set={set} groupOf={groupOf} groupLabel={tt('Console')} allLabel={tt('Todos')} place={tt('todos os consoles')}
          options={x => menu.options(x).filter(o => o.k !== 'info')} run={menu.run} onOpen={x => { sfx.play('ok'); setGame(x.key); }} onBack={() => { sfx.play('back'); onBack(); }} />
        {g && <GameView theme="d-app" g={g} self={isSelfInstall(g.console)} opts={menu.options(g, true)} run={menu.run} onBack={() => setGame(null)} />}
        {toast}
      </Fit>
    </section>
  );
}
