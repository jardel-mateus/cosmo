import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { useSettings } from './settings';
import { getLang } from '@shared/i18n';

export function useTranslated(text: string | null | undefined) {
  const trpc = useTRPC();
  const on = useSettings().translate && getLang() === 'pt';
  const q = useQuery(trpc.i18n.translate.queryOptions({ text: text ?? '' }, { enabled: on && !!text?.trim(), staleTime: Infinity, retry: false }));
  const t = on && q.data ? q.data : null;
  return { text: t ?? text ?? '', auto: !!t && t !== text, loading: on && q.isLoading && !!text?.trim() };
}
