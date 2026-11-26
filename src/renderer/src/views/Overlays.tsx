import { useProfile } from '../lib/profile';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { BASED_ON_URL, PIX_CITY, PIX_KEY, PIX_NAME, REPO_URL, SUPPORT_URL } from '@shared/links';
import { pixPayload } from '@shared/pix';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONSOLE_NAME } from '@shared/consoles';
import type { ConsoleId } from '@shared/types';
import { useTRPC } from '../trpc';
import { useFeed } from '../hubs/data';
import { Glyph } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { ago, fmtPlay, plural } from '../lib/format';
import { Bars } from '../components/Bars';
import { sfx } from '../lib/sfx';
import { tt } from '@shared/i18n';

const TAGS = { new: tt('NOVO'), upd: tt('VERSÃO'), up: tt('SUBIU') } as const;

function Shell({ title, onClose, children, initial }: { title: string; onClose: () => void; children: ReactNode; initial?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active: true, initial, onKey: k => { if (k === 'Escape') { sfx.play('back'); onClose(); return true; } } });
  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hm-ov" ref={root}>
        <h3>{title} <span><Glyph a="back" />{tt('fechar')}</span></h3>
        {children}
      </div>
    </div>
  );
}

export function RadarOverlay({ onClose, onOpenConsole }: { onClose: () => void; onOpenConsole: (c: ConsoleId) => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const radar = useQuery(trpc.catalog.radar.queryOptions());
  const info = useQuery(trpc.catalog.info.queryOptions());
  const refresh = useMutation(trpc.catalog.refresh.mutationOptions({ onSettled: () => qc.invalidateQueries() }));
  const seen = useMutation(trpc.catalog.markRadarSeen.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }) }));
  const extra = useQuery(trpc.catalog.sources.queryOptions());
  const sources = useMutation(trpc.catalog.openSources.mutationOptions({ onSettled: () => qc.invalidateQueries({ queryKey: trpc.catalog.sources.queryKey() }) }));
  const close = () => { seen.mutate(); onClose(); };
  const feed = useFeed(radar.data ?? [], true);

  return (
    <Shell title="RADAR" onClose={close}>
      {radar.data?.length === 0 && <p className="empty">{tt('Nada novo por enquanto. O Cosmo confere o Recompendium toda vez que abre; jogos novos, mudanças de status e versões novas dos seus jogos aparecem aqui.')}</p>}
      {radar.data?.slice(0, 40).map(r => (
        <div key={r.id} className="it-row">
          <button className="it" data-hf onClick={() => { feed.done(r); seen.mutate(); onOpenConsole(r.console); }}>
            <span className={`tag ${r.kind}`}>{TAGS[r.kind]}</span>
            <span className="t">{r.title}</span>
            <span className="s">{CONSOLE_NAME[r.console]}{r.kind !== 'new' ? ` · ${r.detail}` : ''} · {ago(r.at)}</span>
          </button>
          <button className="it-x" data-hf title={tt('Dispensar')} aria-label={tt('Dispensar')} onClick={() => feed.drop(r)}>✕</button>
        </div>
      ))}
      <div className="scan">
        <span>{refresh.error ? tt('Sem conexão com o Recompendium ({0})', { 0: refresh.error.message }) : info.data?.checkedAt ? tt('Verificado {0}', { 0: ago(info.data.checkedAt) }) : tt('Ainda não verificado')}</span>
        {!!radar.data?.length && <button data-hf onClick={() => void feed.clear(radar.data ?? [])}>{tt('Limpar tudo')}</button>}
        <button data-hf title={tt('Abre o fontes.json: coloque ali outros catálogos de jogos (URLs ou arquivos) e depois clique em Verificar agora.')} onClick={() => sources.mutate()}>
          {tt('Fontes de jogos')}{extra.data?.length ? ` (+${extra.data.length})` : ''}</button>
        <button data-hf disabled={refresh.isPending} onClick={() => refresh.mutate({})}>{refresh.isPending ? tt('Verificando…') : tt('Verificar agora')}</button>
      </div>
    </Shell>
  );
}

export function MeOverlay({ onClose }: { onClose: () => void }) {
  const me = useProfile();
  const trpc = useTRPC();
  const summary = useQuery(trpc.library.summary.queryOptions());
  const qc = useQueryClient();
  const recent = useQuery(trpc.achievements.recent.queryOptions({ limit: 8 }));
  const dismiss = useMutation(trpc.achievements.dismiss.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.achievements.recent.pathKey() }) }));
  const drop = (items?: { gameId: string; achId: number }[]) => { sfx.play('back'); dismiss.mutate(items ? { items } : {}); };
  const stats = useQuery(trpc.play.stats.queryOptions());
  const a = summary.data?.achievements, st = stats.data;
  const week = st ? st.days.slice(7).reduce((x, y) => x + y, 0) : 0;
  return (
    <Shell title={me.name.toUpperCase()} onClose={onClose}>
      <div className="hm-big glow">{fmtPlay(st?.totalMs ?? 0)}<small>{tt('{0} nos últimos 7 dias · {1} na biblioteca', { 0: fmtPlay(week * 3600_000), 1: plural(summary.data?.installed ?? 0, tt('jogo'), tt('jogos')) })}</small></div>
      {st && <Bars days={st.days.slice(7)} />}
      <div className="hm-sub hm-achbar"><span>{tt('CONQUISTAS · {0} de {1}', { 0: a?.unlocked ?? 0, 1: a?.total ?? 0 })}</span><span className="grow" />
        {!!recent.data?.length && <button data-hf onClick={() => drop()}>{tt('Limpar')}</button>}</div>
      <div className="hm-ach">
        {recent.data?.length === 0 && <span className="dim">{tt('Nada novo. As conquistas aparecem aqui quando você desbloqueia e somem sozinhas depois de {0} dias; todas continuam na página de cada jogo.', { 0: 14 })}</span>}
        {recent.data?.map(u => (
          <div key={`${u.gameId}:${u.achId}`} className="hm-row">{u.icon ? <img className="hm-ic" src={u.icon} alt="" /> : <i />}<span>{u.name}<br /><small>{u.gameTitle}</small></span><small>{ago(u.at)}</small>
            <button className="hm-x" data-hf title={tt('Apagar')} onClick={() => drop([{ gameId: u.gameId, achId: u.achId }])}>✕</button></div>
        ))}
      </div>
    </Shell>
  );
}

export function SupportOverlay({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [pixQr, setPixQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pix = PIX_KEY ? pixPayload({ key: PIX_KEY, name: PIX_NAME, city: PIX_CITY, message: 'Apoio ao Cosmo' }) : '';
  useEffect(() => {
    const opts = { type: 'svg' as const, margin: 1, color: { dark: '#0a0f1f', light: '#ffffff' } };
    if (SUPPORT_URL) void QRCode.toString(SUPPORT_URL, opts).then(setQr).catch(() => setQr(null));
    if (pix) void QRCode.toString(pix, opts).then(setPixQr).catch(() => setPixQr(null));
  }, [pix]);
  const open = (u: string) => { sfx.play('ok'); window.open(u, '_blank'); };
  const copy = async () => {
    sfx.play('ok');
    try { await navigator.clipboard.writeText(pix); } catch {
      const t = document.createElement('textarea'); t.value = pix; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setCopied(true); window.setTimeout(() => setCopied(false), 2500);
  };
  return (
    <Shell title={tt('APOIE O COSMO')} onClose={onClose} initial="[data-main]">
      <div className="sup">
        <p>{tt('O Cosmo é de graça e vai continuar sendo. Se ele te ajudou a achar ou organizar seus jogos, um café ajuda a manter o catálogo, as capas e os hubs em dia.')}</p>
        {pix && (
          <div className="sup-qr">
            {pixQr && <span className="qr" dangerouslySetInnerHTML={{ __html: pixQr }} />}
            <div>
              <b>{tt('Doe por Pix: aponte a câmera do app do banco')}</b>
              <small>{tt('Chave Pix (e-mail): {0}', { 0: PIX_KEY })}</small>
              <button className="hm-go" data-hf data-main onClick={() => void copy()}>{copied ? tt('✓ COPIADO!') : tt('COPIAR PIX COPIA E COLA')}</button>
            </div>
          </div>
        )}
        {SUPPORT_URL ? (
          <div className="sup-qr">
            {qr && <span className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
            <div>
              <b>{tt('Aponte a câmera do celular')}</b>
              <small>{SUPPORT_URL.replace(/^https?:\/\//, '')}</small>
              <button className="hm-go" data-hf data-main={pix ? undefined : true} onClick={() => open(SUPPORT_URL)}>{tt('☕ ABRIR NO NAVEGADOR')}</button>
            </div>
          </div>
        ) : !pix && <p className="dim">{tt('O link de apoio ainda não foi configurado nesta versão.')}</p>}
        {REPO_URL && <>
          <div className="hm-sub">{tt('OUTRAS FORMAS DE AJUDAR')}</div>
          <button className="it" data-hf data-main={SUPPORT_URL || pix ? undefined : true} onClick={() => open(REPO_URL)}>
            <span className="tag">★</span><span className="t">{tt('Dar uma estrela no GitHub')}</span><span className="s">{tt('Ajuda mais gente a encontrar o Cosmo.')}</span>
          </button>
          <button className="it" data-hf onClick={() => open(`${REPO_URL}/issues/new`)}>
            <span className="tag">!</span><span className="t">{tt('Avisar de um problema ou sugerir algo')}</span><span className="s">{tt('Jogo faltando, capa errada, conquista que não contou.')}</span>
          </button>
        </>}
        <div className="hm-sub">{tt('CRÉDITOS')}</div>
        <button className="it" data-hf data-main={SUPPORT_URL || REPO_URL || pix ? undefined : true} onClick={() => open(BASED_ON_URL)}>
          <span className="tag">♥</span><span className="t">{tt('Baseado no projeto Cartucho original')}</span><span className="s">{tt('Código aberto sob licença MIT, de Jardel Mateus Dias de Oliveira.')}</span>
        </button>
      </div>
    </Shell>
  );
}
