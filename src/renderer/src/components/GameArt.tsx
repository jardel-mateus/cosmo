import { tt } from '@shared/i18n';
import { useState } from 'react';
import { useArt } from '../lib/art';
import { Cover } from './Cover';

interface Props {
  /** Selo de 100% das conquistas no canto. */
  done?: boolean;
  title: string;
  console: string | null | undefined;
  platformName?: string | null;
  /** Capa do Recompendium, para quando o LaunchBox não tem o jogo. */
  fallback?: string | null;
  /** cover = capa da caixa; wide/square = arte de fundo com o logo por cima (cai para a capa se não houver). */
  variant?: 'cover' | 'wide' | 'square';
  className?: string;
}

export function GameArt({ title, console, platformName, fallback, variant = 'cover', className = '', done = false }: Props) {
  const a = useArt(console, title, platformName);
  const [bad, setBad] = useState(false);
  // Com capa escolhida pelo jogador, ela aparece em todo lugar (no lugar da arte de fundo).
  if (variant !== 'cover' && a.fanart && !a.custom && !bad) {
    return (
      <div className={`cv art ${variant} ${className}`}>
        <img className="art-bg" src={a.fanart} alt="" onError={() => setBad(true)} />
        {a.logo ? <img className="art-logo" src={a.logo} alt={title} /> : <span className="art-title">{title}</span>}
        {done && <span className="cv-done" title={tt('100% das conquistas')}>100%</span>}
      </div>
    );
  }
  return <Cover title={title} url={a.cover ?? fallback} className={className} done={done} />;
}
