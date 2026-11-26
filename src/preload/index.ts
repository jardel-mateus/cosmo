import { exposeElectronTRPC } from 'electron-trpc/preload';

// A única ponte entre a tela e o processo principal: as chamadas tRPC.
exposeElectronTRPC();
