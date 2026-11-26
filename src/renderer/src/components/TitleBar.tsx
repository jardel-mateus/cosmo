import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '../trpc';
import { tt } from '@shared/i18n';

export function TitleBar({ ctx, onMenu }: { ctx: string | null; onMenu: () => void }) {
  const trpc = useTRPC();
  const st = useQuery(trpc.win.state.queryOptions());
  const [fs, setFs] = useState<boolean | null>(null);
  useSubscription(trpc.win.onState.subscriptionOptions(undefined, { onData: d => setFs(d.fullscreen) }));
  const full = fs ?? st.data?.fullscreen ?? false;
  const toggle = useMutation(trpc.win.toggleFullScreen.mutationOptions());
  useEffect(() => { document.body.classList.toggle('has-tb', !full); }, [full]);
  if (full) return null;
  return (
    <header className={`tb ${navigator.userAgent.includes('Mac') ? 'mac' : ''}`} onDoubleClick={e => { if (e.target === e.currentTarget) toggle.mutate(); }}>
      <span className="logo tb-logo"><i />{tt('COSMO')}</span>
      {ctx && <span className="tb-ctx">{ctx}</span>}
      <span className="sp" />
      <button className="tb-fs" title={tt('Menu do Cosmo (Start no controle, F1 no teclado)')} onClick={onMenu}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>{tt('Menu')}</button>
      <button className="tb-fs" title={tt('Tela cheia (Alt+Enter ou F11)')} onClick={() => toggle.mutate()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>{tt('Tela cheia')}<kbd>{tt('Alt+Enter')}</kbd>
      </button>
    </header>
  );
}
