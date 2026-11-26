import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { ipcLink } from 'electron-trpc/renderer';
import superjson from 'superjson';
import type { AppRouter } from '../../main/router';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });
export const trpcClient = createTRPCClient<AppRouter>({ links: [ipcLink<AppRouter>({ transformer: superjson })] });
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
