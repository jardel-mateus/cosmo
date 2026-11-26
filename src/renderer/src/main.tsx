import './lib/lang';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/rubik/300.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import './styles.css';
import './hubs/hubs.css';
import './hubs/switch.css';
import './hubs/ps5.css';
import './hubs/ps4.css';
import './hubs/ps3.css';
import './hubs/x360.css';
import './hubs/wii.css';
import './components/discover.css';
import './hubs/retro.css';
import './hubs/pc.css';
import './cosmo.css';
import './cosmo-skin.css';
import { queryClient, trpcClient, TRPCProvider } from './trpc';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
