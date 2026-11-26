import type { InstalledGame, LibrarySummary } from '@shared/types';
import { CONSOLE_NAME } from '@shared/consoles';
import { GameArt } from '../components/GameArt';
import { ago, fmtPlay, plural } from '../lib/format';
import { CONSOLES } from '../stage/consoles';
import { tt } from '@shared/i18n';

interface Props {
  games: InstalledGame[] | undefined;
  summary: LibrarySummary | undefined;
  onOpenGame: (g: InstalledGame) => void;
  onPlay: (g: InstalledGame) => void;
  playError: string | null;
  onStage: () => void;
  onAddGame: () => void;
  adding: boolean;
  starting: string | null;
}

export const showCap = (e: { currentTarget: HTMLElement }) => setCaption(e.currentTarget);
export function setCaption(el: HTMLElement | null) { const c = document.getElementById('hmCap'); if (c) c.textContent = el?.dataset.cap ?? ''; }

export function Home({ games, summary, onOpenGame, onPlay, playError, onStage, onAddGame, adding, starting }: Props) {
  if (!games) return null;
  const sorted = [...games].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
  const top = sorted[0], rec = sorted.slice(1, 7);
  const color = (id: string) => CONSOLES.find(c => c.id === id)?.color ?? 'var(--acc)';

  if (!top) return (
    <div className="home">
      <div className="hm2-hero">
        <div className="hm2-txt">
          <span className="k" style={{ color: 'var(--pink)' }}>{tt('BEM-VINDO')}</span>
          <h1>{tt('Sua biblioteca está vazia')}</h1>
          <p>{tt('{0}Escolha um console para ver o que existe, ou aponte a pasta de um jogo que você já tem.', { 0: summary?.catalogTotal ? tt('{0} recomps, ports e emuladores no catálogo. ', { 0: summary.catalogTotal }) : '' })}</p>
          <div className="hm-btns">
            <button className="hm-go" data-hf data-main onClick={onStage}>{tt('ESCOLHER UM CONSOLE')}</button>
            <button className="hm-go ghost" data-hf onClick={onAddGame} disabled={adding}>{adding ? tt('LENDO A PASTA…') : tt('+ ADICIONAR JOGO')}</button>
          </div>
        </div>
      </div>
    </div>
  );

  const a = top.achievements, live = top.running || starting === top.id;
  return (
    <div className="home">
      <div className="hm2-hero">
        <GameArt title={top.title} console={top.console} fallback={top.coverUrl} done={!!top.achievements?.complete} />
        <div className="hm2-txt">
          <span className="k" style={{ color: color(top.console) }}>{live ? tt('JOGANDO AGORA') : top.lastPlayed ? tt('CONTINUAR') : tt('NA SUA BIBLIOTECA')} · {CONSOLE_NAME[top.console].toUpperCase()}</span>
          <h1>{top.title}</h1>
          <p>{top.lastPlayed ? tt('{0} jogadas · {1}', { 0: fmtPlay(top.playMs), 1: ago(top.lastPlayed) }) : tt('adicionado {0}', { 0: ago(top.addedAt) })}{a && a.total ? tt(' · {0}/{1} conquistas', { 0: a.unlocked, 1: a.total }) : ''}</p>
          <div className="hm-btns">
            {live
              ? <button className="hm-go live" data-hf data-main onClick={() => onOpenGame(top)}>{tt('● JOGANDO')}</button>
              : top.exe
                ? <button className="hm-go" data-hf data-main onClick={() => onPlay(top)}>▶ {top.lastPlayed ? tt('CONTINUAR') : tt('JOGAR')}</button>
                : <button className="hm-go" data-hf data-main onClick={() => onOpenGame(top)}>{tt('▶ ABRIR')}</button>}
            {top.exe && !live && <button className="hm-go ghost" data-hf onClick={() => onOpenGame(top)}>{tt('DETALHES')}</button>}
          </div>
          {playError && <p className="err" style={{ margin: 0 }}>{playError}</p>}
        </div>
      </div>
      <div className="hm2-rec">
        <div className="hm2-row">
          {rec.map(g => (
            <button key={g.id} data-hf aria-label={g.title} onClick={() => onOpenGame(g)}
              onMouseEnter={showCap} data-cap={`${g.title} · ${CONSOLE_NAME[g.console]}${g.playMs ? ` · ${fmtPlay(g.playMs)}` : ''}`}>
              <GameArt title={g.title} console={g.console} fallback={g.coverUrl} done={!!g.achievements?.complete} />
            </button>
          ))}
          <button className="more" data-hf data-cap={tt('Adicionar jogo')} aria-label={tt('Adicionar jogo')} onClick={onAddGame} onMouseEnter={showCap}>+</button>
          <button className="more" data-hf data-cap={tt('Todos os consoles')} aria-label={tt('Todos os consoles')} onClick={onStage} onMouseEnter={showCap}>▶</button>
        </div>
        <div className="hm2-cap" id="hmCap" />
      </div>
      {summary && summary.installed > 7 && <span className="dim">{tt('{0} na biblioteca', { 0: plural(summary.installed, tt('jogo'), tt('jogos')) })}</span>}
    </div>
  );
}
