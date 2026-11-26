import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { closeWeb, useWebReq } from '../lib/web';
import { sfx } from '../lib/sfx';
import { tt } from '@shared/i18n';

export function WebHost() {
  const req = useWebReq();
  const trpc = useTRPC();
  const frame = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; title: string } | null>(null);
  const open = useMutation(trpc.web.open.mutationOptions());
  const place = useMutation(trpc.web.place.mutationOptions());
  const scroll = useMutation(trpc.web.scroll.mutationOptions());
  const back = useMutation(trpc.web.back.mutationOptions());
  const external = useMutation(trpc.web.external.mutationOptions());
  const close = useMutation(trpc.web.close.mutationOptions());
  useSubscription(trpc.web.onClosed.subscriptionOptions(undefined, { onData: () => { sfx.play('back'); closeWeb(); } }));
  useSubscription(trpc.web.onState.subscriptionOptions(undefined, { onData: s => setState(s) }));

  const rect = () => { const r = frame.current?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; };
  useEffect(() => {
    if (!req) return;
    setState({ loading: true, title: '' });
    const r = rect(); if (r) open.mutate({ url: req.url, rect: r });
    const ro = new ResizeObserver(() => { const n = rect(); if (n) place.mutate(n); });
    if (frame.current) ro.observe(frame.current);
    const onWin = () => { const n = rect(); if (n) place.mutate(n); };
    addEventListener('resize', onWin);
    return () => { ro.disconnect(); removeEventListener('resize', onWin); close.mutate(); };
  }, [req?.url]);

  const quit = () => { sfx.play('back'); closeWeb(); };
  useKeys((k: Key) => {
    if (k === 'Escape') return quit();
    if (k === 'ArrowDown') return scroll.mutate({ dy: 320 });
    if (k === 'ArrowUp') return scroll.mutate({ dy: -320 });
    if (k === 'RT') return scroll.mutate({ dy: 900 });
    if (k === 'LT') return scroll.mutate({ dy: -900 });
    if (k === 'LB') { sfx.play('move'); return back.mutate(); }
    if (k === 'Y') { sfx.play('ok'); external.mutate(); closeWeb(); }
  }, !!req);

  if (!req) return null;
  return (
    <div className="web-ov">
      <div className="web-bar">
        <b>{req.title}</b>
        <span className="web-url">{state?.loading ? tt('Carregando…') : state?.title ?? ''}</span>
        <span className="web-hints">
          <span><Glyph a="ud" />{tt('Rolar')}</span>
          <span><Glyph a="lb" />{tt('Voltar página')}</span>
          <span><Glyph a="y" />{tt('Abrir no navegador')}</span>
          <button onClick={quit}><Glyph a="back" />{tt('Fechar')}</button>
        </span>
      </div>
      <div className="web-frame" ref={frame} />
    </div>
  );
}
