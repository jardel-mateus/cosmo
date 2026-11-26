import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

export function useArt(console: string | null | undefined, title: string, platformName?: string | null) {
  const trpc = useTRPC();
  const q = useQuery(trpc.art.get.queryOptions({ console: console ?? 'other', platformName, title }, { enabled: !!console, staleTime: Infinity }));
  return q.data ?? {};
}

export function useShots(console: string | null | undefined, title: string, platformName?: string | null) {
  const trpc = useTRPC();
  const q = useQuery(trpc.art.shots.queryOptions({ console: console ?? 'other', platformName, title }, { enabled: !!console && !!title, staleTime: Infinity }));
  return q.data ?? [];
}

export function useInfo(console: string | null | undefined, title: string, platformName?: string | null, id?: string | null, catalogId?: string | null) {
  const trpc = useTRPC();
  const q = useQuery(trpc.art.info.queryOptions({ console: console ?? 'other', platformName, title, id, catalogId }, { enabled: !!console && !!title, staleTime: Infinity }));
  return q.data ?? null;
}
