import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { useSettings } from './settings';
import { tt } from '@shared/i18n';

export const AVATARS: [string, string][] = [['acc', tt('Cor da paleta')], ['#ff3ea5', tt('Rosa')], ['#34e3ff', tt('Ciano')], ['#ffb43d', tt('Âmbar')], ['#b6ff5c', tt('Lima')], ['#8f7bff', tt('Lilás')], ['#ff6a4d', tt('Coral')], ['#e8e8f0', tt('Prata')]];

const nice = (u: string | undefined) => (u ? u.charAt(0).toUpperCase() + u.slice(1) : '');

export function useProfile() {
  const s = useSettings();
  const trpc = useTRPC();
  const user = useQuery(trpc.system.user.queryOptions(undefined, { staleTime: Infinity }));
  const name = s.name.trim() || nice(user.data) || 'Jogador';
  return { name, initial: name.charAt(0).toUpperCase(), color: s.avatar === 'acc' ? 'var(--acc)' : s.avatar, custom: !!s.name.trim(), suggested: nice(user.data) };
}
