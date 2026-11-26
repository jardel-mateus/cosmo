import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '../trpc';
import { cancelBindRec, cancelKeyRec, Glyph, IdxChips, PAD_NAMES, useBindRec, useKeyRec, useKeys, usePadKind } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { sfx } from '../lib/sfx';
import { askConfirm, setMenuOpen, useConfirmReq } from '../lib/dialogs';
import { CONSOLES } from '../stage/consoles';
import { SearchBox } from '../components/SearchBox';
import { tt } from '@shared/i18n';

export function ConfirmHost() {
  const req = useConfirmReq();
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active: !!req, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); req?.resolve(false); return true; } } });
  if (!req) return null;
  return (
    <div className="ov gl-ov">
      <div className="gl-box" ref={root}>
        <h3>{req.title}</h3>
        {req.text && <p>{req.text}</p>}
        <div className="gl-btns">
          <button className="btn" data-hf data-main onClick={() => { sfx.play('back'); req.resolve(false); }}>{req.cancel ?? tt('Cancelar')}</button>
          {req.alt && <button className="btn" data-hf onClick={() => { sfx.play('ok'); req.resolve('alt'); }}>{req.alt}</button>}
          <button className={`btn ${req.danger ? 'danger' : 'acc'}`} data-hf onClick={() => { sfx.play('ok'); req.resolve(true); }}>{req.ok ?? tt('Confirmar')}</button>
        </div>
      </div>
    </div>
  );
}

export const BIND_NAMES = () => ({ summon: tt('Chamar o Cosmo'), shot: tt('Tirar captura de tela') });

export function BindRecHost() {
  const r = useBindRec();
  const kr = useKeyRec();
  useKeys(k => { if (k === 'Escape') { sfx.play('back'); cancelBindRec(); } }, !!r);
  if (kr) return (
    <div className="ov gl-ov" onClick={() => { sfx.play('back'); cancelKeyRec(); }}>
      <div className="gl-box gl-padset">
        <h3>{kr.label}</h3>
        <p>{tt('Aperte no teclado a tecla que você quer para esta ação.')}</p>
        <div className="gl-padstep gl-bindstep"><span>{tt('Esperando uma tecla…')}</span></div>
        <p className="gl-padnote">{kr.k === 'Escape' ? tt('Esc deixa o Esc como Voltar. Clique fora para cancelar.') : tt('Esc cancela.')}</p>
      </div>
    </div>
  );
  if (!r) return null;
  return (
    <div className="ov gl-ov">
      <div className="gl-box gl-padset">
        <h3>{r.label}</h3>
        <p>{r.multi ? tt('Aperte no controle o botão ou a combinação (até 4 botões) e solte. Botões extras do controle também valem.') : tt('Aperte no controle o botão que você quer para esta ação. Botões extras do controle também valem.')}</p>
        <div className="gl-padstep gl-bindstep">{r.got.length ? <IdxChips idx={r.got} pad={r.pad} /> : <span>{tt('Esperando um botão…')}</span>}</div>
        <p className="gl-padnote">{r.multi ? tt('Escolha botões que os jogos não usam. Esc no teclado cancela.') : tt('Esc no teclado cancela.')}</p>
      </div>
    </div>
  );
}

const PLATFORM_ORDER = ['pc', ...CONSOLES.map(c => c.id).filter(id => id !== 'pc' && id !== 'other'), 'other'];

const mb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1048576))} MB` : '');

export function DownloadAskHost() {
  const trpc = useTRPC(), qc = useQueryClient();
  const [req, setReq] = useState<{ id: number; title: string; items: { name: string; size: number | null }[] } | null>(null);
  const answer = useMutation(trpc.wine.answerDownload.mutationOptions());
  const always = useMutation(trpc.wine.setAskDownloads.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.wine.pathKey() }) }));
  useSubscription(trpc.wine.onAskDownload.subscriptionOptions(undefined, { onData: r => setReq(r) }));
  const root = useRef<HTMLDivElement>(null);
  const done = (ok: boolean, forever = false) => {
    if (!req) return;
    sfx.play(ok ? 'ok' : 'back');
    if (forever) always.mutate({ on: false });
    answer.mutate({ id: req.id, ok });
    setReq(null);
  };
  useSpatialNav(root, { active: !!req, initial: '[data-main]', onKey: k => { if (k === 'Escape') { done(false); return true; } } });
  if (!req) return null;
  const total = req.items.reduce((n, d) => n + (d.size ?? 0), 0);
  return (
    <div className="ov gl-ov">
      <div className="gl-box" ref={root}>
        <h3>{tt('O Cosmo precisa baixar algumas coisas para abrir {0}', { 0: req.title })}</h3>
        <ul className="gl-dl">{req.items.map(d => <li key={d.name}>{d.name}{d.size ? <span>{mb(d.size)}</span> : null}</li>)}</ul>
        <p>{total ? tt('Total: cerca de {0}. Fica guardado e só baixa uma vez.', { 0: mb(total) }) : tt('Fica guardado e só baixa uma vez.')}</p>
        <div className="gl-btns">
          <button className="btn" data-hf onClick={() => done(false)}>{tt('Agora não')}</button>
          <button className="btn" data-hf onClick={() => done(true, true)}>{tt('Sempre baixar sem perguntar')}</button>
          <button className="btn acc" data-hf data-main onClick={() => done(true)}>{tt('Baixar')}</button>
        </div>
      </div>
    </div>
  );
}

export function PlatformHost() {
  const trpc = useTRPC();
  const [req, setReq] = useState<{ id: number; title: string; current: string | null } | null>(null);
  const answer = useMutation(trpc.games.answerPlatform.mutationOptions());
  useSubscription(trpc.games.onAskPlatform.subscriptionOptions(undefined, { onData: r => setReq(r) }));
  const root = useRef<HTMLDivElement>(null);
  const done = (c: string | null) => { if (!req) return; sfx.play(c ? 'ok' : 'back'); answer.mutate({ id: req.id, console: c }); setReq(null); };
  useSpatialNav(root, { active: !!req, initial: '[data-main]', onKey: k => { if (k === 'Escape') { done(null); return true; } } });
  if (!req) return null;
  const main = req.current ?? 'pc';
  return (
    <div className="ov gl-ov">
      <div className="gl-box gl-plat" ref={root}>
        <h3>{tt('De qual plataforma é {0}?', { 0: req.title })}</h3>
        <p>{tt('O jogo vai aparecer nessa plataforma, e o Cosmo usa ela para achar capa, sinopse e nota.')}</p>
        <div className="gl-plats">{PLATFORM_ORDER.map(id => {
          const c = CONSOLES.find(x => x.id === id)!;
          return (
            <button key={id} className={`btn ${id === req.current ? 'cur' : ''}`} data-hf {...(id === main ? { 'data-main': '' } : {})} onClick={() => done(id)}>
              <i style={{ background: c.color }} />{id === 'pc' ? tt('PC (Windows)') : c.name}
            </button>
          );
        })}</div>
        <div className="gl-btns"><button className="btn" data-hf onClick={() => done(null)}>{req.current ? tt('Cancelar') : tt('Decidir depois')}</button></div>
      </div>
    </div>
  );
}

interface Req { id: number; title: string; kind: 'dir' | 'exe' | 'img'; start: string; explicit?: boolean }
const LAST_DIR = 'cartucho.lastDir';

export function PickerHost() {
  const trpc = useTRPC();
  const pad = usePadKind();
  const [req, setReq] = useState<Req | null>(null);
  const [path, setPath] = useState('');
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [col, setCol] = useState<'path' | 'list' | 'side'>('list');
  const [si, setSi] = useState(0);
  const addr = useRef<HTMLInputElement>(null);
  const answer = useMutation(trpc.fs.answer.mutationOptions());
  const stat = useMutation(trpc.fs.stat.mutationOptions());
  const clip = useMutation(trpc.system.clipboard.mutationOptions());
  const go = (p: string) => { setPath(p); setTyped(p); setSel(0); setErr(null); setCol('list'); };
  useSubscription(trpc.fs.onPick.subscriptionOptions(undefined, {
    onData: r => {
      let start = r.start;
      if (!r.explicit) { try { start = localStorage.getItem(`${LAST_DIR}.${r.kind}`) || r.start; } catch { } }
      setReq(r); go(start); setSi(0);
    },
  }));
  const q = useQuery(trpc.fs.list.queryOptions({ path, kind: req?.kind ?? 'dir' }, { enabled: !!req && !!path }));
  const listRef = useRef<HTMLDivElement>(null);
  const done = (p: string | null, native = false) => {
    if (!req) return;
    if (p) { try { localStorage.setItem(`${LAST_DIR}.${req.kind}`, req.kind === 'dir' ? p : (q.data?.path ?? path)); } catch { } }
    answer.mutate({ id: req.id, path: p, native }); setReq(null);
  };
  const goTyped = async (text: string) => {
    const t = text.trim();
    if (!t || t === path) { setTyped(path); setCol('list'); return; }
    const r = await stat.mutateAsync({ path: t });
    if (!r.exists) { setErr(tt('Não encontrei esse endereço.')); setCol('path'); setTimeout(() => addr.current?.focus(), 0); return; }
    if (r.dir) { sfx.play('ok'); go(r.path); return; }
    if (req?.kind === 'exe' || req?.kind === 'img') { sfx.play('ok'); done(r.path); return; }
    setErr(tt('Esse endereço é de um arquivo. Escolha uma pasta.')); setCol('path'); setTimeout(() => addr.current?.focus(), 0);
  };
  const paste = () => void clip.mutateAsync().then(t => { const s = (t ?? '').split(/\r?\n/)[0]!.trim(); if (s) { setTyped(s); void goTyped(s); } else setErr(tt('A área de transferência está vazia.')); });
  const up = () => { if (q.data?.parent) { sfx.play('back'); go(q.data.parent); } };
  const entries = q.data?.entries ?? [];
  const places = q.data?.places ?? [];
  const rows: { k: string; label: string; act: () => void; kind: 'use' | 'up' | 'dir' | 'file' }[] = req ? [
    ...(req.kind === 'dir' ? [{ k: 'use', label: tt('Usar esta pasta'), act: () => { sfx.play('ok'); done(path); }, kind: 'use' as const }] : []),
    ...(q.data?.parent ? [{ k: 'up', label: '.. (voltar uma pasta)', act: up, kind: 'up' as const }] : []),
    ...entries.map(e => ({ k: e.path, label: e.name, act: () => { sfx.play('ok'); if (e.dir) go(e.path); else done(e.path); }, kind: e.dir ? 'dir' as const : 'file' as const })),
  ] : [];
  const side = req ? [
    { k: 'paste', label: tt('Colar endereço'), act: () => { sfx.play('ok'); paste(); } },
    ...places.map(p => ({ k: p.path, label: p.name, act: () => { sfx.play('move'); go(p.path); } })),
    { k: 'native', label: tt('Janela do Windows…'), act: () => { sfx.play('ok'); done(null, true); } },
  ] : [];
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel, col, si]);
  useEffect(() => { if (col !== 'path' && document.activeElement === addr.current) addr.current?.blur(); }, [col]);

  const ahead = useRef({ text: '', at: 0 });
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || document.querySelector('.osk-ov')) return;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { stop(); paste(); return; }
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') || e.key === 'F4') { stop(); setCol('path'); addr.current?.focus(); addr.current?.select(); return; }
      if (e.key === 'Backspace') { stop(); up(); return; }
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        stop();
        const now = Date.now(), a = ahead.current;
        a.text = now - a.at > 900 ? e.key.toLowerCase() : a.text + e.key.toLowerCase(); a.at = now;
        const j = rows.findIndex(r => (r.kind === 'dir' || r.kind === 'file') && r.label.toLowerCase().startsWith(a.text));
        if (j >= 0) { sfx.play('move'); setCol('list'); setSel(j); }
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });

  useKeys(k => {
    if (!req) return;
    if (col === 'path') {
      if (k === 'Enter') { sfx.play('ok'); addr.current?.focus(); }
      else if (k === 'ArrowDown') { sfx.play('move'); setCol('list'); }
      else if (k === 'Escape') { sfx.play('back'); done(null); }
      return;
    }
    const n = col === 'list' ? rows.length : side.length, cur = col === 'list' ? sel : si, set = col === 'list' ? setSel : setSi;
    if (k === 'ArrowDown' && cur < n - 1) { sfx.play('move'); set(cur + 1); }
    else if (k === 'ArrowUp') { if (cur > 0) { sfx.play('move'); set(cur - 1); } else { sfx.play('move'); setCol('path'); } }
    else if (k === 'RT') { sfx.play('move'); set(Math.min(n - 1, cur + 8)); }
    else if (k === 'LT') { sfx.play('move'); set(Math.max(0, cur - 8)); }
    else if (k === 'ArrowLeft' && col === 'list') { if (q.data?.parent && pad !== 'kb') up(); else { sfx.play('move'); setCol('side'); } }
    else if (k === 'ArrowRight' && col === 'side') { sfx.play('move'); setCol('list'); }
    else if (k === 'ArrowRight' && col === 'list') { const r = rows[sel]; if (r?.kind === 'dir') r.act(); }
    else if (k === 'Enter') (col === 'list' ? rows[sel] : side[si])?.act();
    else if (k === 'Y' && req.kind === 'dir') { sfx.play('ok'); done(path); }
    else if (k === 'X') up();
    else if (k === 'LB') { sfx.play('move'); setCol('side'); }
    else if (k === 'Escape') { sfx.play('back'); done(null); }
  }, !!req);
  if (!req) return null;
  const kb = pad === 'kb';
  return (
    <div className="ov gl-ov">
      <div className="gl-pick">
        <h3>{req.title}</h3>
        <div className={`gl-addr ${col === 'path' ? 'f' : ''}`}>
          <SearchBox ref={addr} className="gl-path" nav={false} placeholder={tt('Endereço da pasta')} value={typed}
            onChange={v => { setTyped(v); setErr(null); }} onDone={() => void goTyped(typed)} />
          <button className="btn" onClick={() => void goTyped(typed)}>{tt('Ir')}</button>
          <button className="btn" onClick={paste} title={tt('Colar endereço (Ctrl+V)')}>{tt('Colar')}</button>
        </div>
        {err && <div className="gl-err">{err}</div>}
        <div className="gl-cols">
          <div className={`gl-side ${col === 'side' ? 'f' : ''}`}>{side.map((p, j) => (
            <button key={p.k} className={`${col === 'side' && j === si ? 'on' : ''} ${p.k === 'paste' ? 'paste' : ''}`} onClick={p.act}>{p.label}</button>
          ))}</div>
          <div className={`gl-list ${col === 'list' ? 'f' : ''}`} ref={listRef}>
            {q.isLoading ? <div className="gl-empty">{tt('Lendo…')}</div> : rows.map((r, j) => (
              <button key={r.k} className={`${r.kind} ${col === 'list' && j === sel ? 'on' : ''}`}
                onClick={() => { if (r.kind === 'use' || r.kind === 'up') r.act(); else { setCol('list'); setSel(j); } }} onDoubleClick={() => { if (r.kind !== 'use' && r.kind !== 'up') r.act(); }}>
                <span className="ic">{r.kind === 'use' ? '✔' : r.kind === 'up' ? '↰' : r.kind === 'dir' ? '▸' : '◆'}</span>{r.label}
              </button>
            ))}
            {!q.isLoading && !entries.length && <div className="gl-empty">{req.kind === 'exe' ? tt('Nenhuma pasta ou programa aqui.') : req.kind === 'img' ? tt('Nenhuma pasta ou imagem aqui.') : tt('Nenhuma pasta aqui.')}</div>}
          </div>
        </div>
        <div className="gl-h">
          {kb ? <>
            <span><Glyph a="ok" />{tt('Abrir')}</span><span><b className="gp kb">⌫</b>{tt('Pasta acima')}</span><span><b className="gp kb">{tt('Ctrl+L')}</b>{tt('Endereço')}</span>
            <span><b className="gp kb">{tt('Ctrl+V')}</b>{tt('Colar')}</span><span>{tt('Digite para pular para uma pasta')}</span><span><Glyph a="back" />{tt('Cancelar')}</span>
          </> : <>
            <span><Glyph a="ok" />{tt('Abrir')}</span>{req.kind === 'dir' && <span><Glyph a="y" />{tt('Usar esta pasta')}</span>}
            <span><Glyph a="x" />{tt('Pasta acima')}</span><span><Glyph a="ud" />{tt('Endereço no topo')}</span><span><Glyph a="lb" />{tt('Locais')}</span><span><Glyph a="back" />{tt('Cancelar')}</span>
          </>}
        </div>
      </div>
    </div>
  );
}

export function CartuchoMenu({ inside, onSettings, onRadar, onProfile, onPickConsoles, onLeave, onClose, onAll, onSupport }: {
  inside: string | null; onSettings: () => void; onRadar: () => void; onProfile: () => void; onPickConsoles: () => void; onLeave: () => void; onClose: () => void; onAll: () => void; onSupport: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const s = useSettings();
  const pad = usePadKind();
  useEffect(() => { setMenuOpen(true); return () => setMenuOpen(false); }, []);
  useSpatialNav(root, { active: true, initial: '[data-main]', onKey: k => { if (k === 'Escape' || k === 'Start') { sfx.play('back'); onClose(); return true; } } });
  const trpc = useTRPC();
  const quit = useMutation(trpc.system.quit.mutationOptions());
  const cyclePad = () => { const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(getSettings().pad) + 1) % o.length]! }); };
  const go = (f: () => void) => () => { sfx.play('ok'); onClose(); f(); };
  return (
    <div className="ov gl-ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gl-menu" ref={root}>
        <h3><i />{tt('COSMO')}{inside ? <small>{inside}</small> : null}</h3>
        <button data-hf className="sup-b" onClick={go(onSupport)}>{tt('♥ Apoiar o Cosmo')}</button>
        {inside && <button data-hf data-main onClick={go(onLeave)}>{tt('◀ Voltar ao palco')}</button>}
        <button data-hf data-main={inside ? undefined : true} onClick={go(onSettings)}>{tt('⚙ Configurações')}</button>
        {inside !== tt('Todos os jogos') && <button data-hf onClick={go(onAll)}>{tt('▤ Todos os jogos')}</button>}
        <button data-hf onClick={go(onRadar)}>{tt('● Novidades do radar')}</button>
        <button data-hf onClick={go(onProfile)}>{tt('◉ Perfil e conta')}</button>
        <button data-hf onClick={go(onPickConsoles)}>{tt('▦ Consoles no palco')}</button>
        <button data-hf onClick={() => { sfx.play('move'); cyclePad(); }}>{tt('🎮 Botões: {0}', { 0: s.pad === 'auto' ? tt('Auto ({0})', { 0: PAD_NAMES[pad] }) : PAD_NAMES[s.pad] })}</button>
        <button data-hf onClick={() => { setSettings({ snd: !s.snd }); sfx.play('move'); }}>{tt('♪ Sons: {0}', { 0: s.snd ? 'ligados' : 'desligados' })}</button>
        <button data-hf className="quit" onClick={() => { sfx.play('ok'); void askConfirm({ title: tt('Sair do Cosmo?'), text: tt('O Cosmo fecha de vez, sem ficar na bandeja. Jogos abertos continuam rodando, mas o tempo deles para de contar.'), ok: tt('Sair'), cancel: tt('Ficar') }).then(y => { if (y) quit.mutate(); }); }}>{tt('⏻ Sair do Cosmo')}</button>
        <div className="gl-h"><span><Glyph a="ok" />{tt('Escolher')}</span><span><Glyph a="back" />{tt('Fechar')}</span></div>
      </div>
    </div>
  );
}
