import { askConfirm } from '../lib/dialogs';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { SearchBox } from '../components/SearchBox';
import { AVATARS, useProfile } from '../lib/profile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import { useTRPC } from '../trpc';
import { BindChips, buttonOf, Glyph, KB_DEFAULT, keyLabel, PAD_NAMES, PadTester, PhysGlyph, rebind, rebindKey, recordButtons, recordKey, resetKbMap, resetPadMap, SETUP_STEPS, tokensOf, useKbMap, usePad, usePadKind, type Key } from '../lib/input';
import { BIND_NAMES } from './GlobalUI';
import { bindsFor } from '@shared/binds';
import { PALETTES, paletteById } from '../lib/palettes';
import { setSettings, useSettings, type Settings as S } from '../lib/settings';
import { useSpatialNav } from '../lib/spatial';
import { initAudio, sfx } from '../lib/sfx';
import { stepFocused, WineOptions } from '../components/WineOptions';
import { getLang, tt } from '@shared/i18n';

type Row =
  | { k: keyof S; t: string; d: string; kind: 'sw' }
  | { k: keyof S; t: string; d: string; kind: 'lvl'; step: number }
  | { k: keyof S; t: string; d: string; kind: 'pick'; opts: [string, string][] };

const ROWS: Record<string, Row> = Object.fromEntries(([
  { k: 'avatar', t: tt('Cor do avatar'), d: tt('A bolinha com a sua inicial, no topo e nos consoles.'), kind: 'pick', opts: AVATARS },
  { k: 'pal', t: tt('Paleta'), d: tt('Cores do Cosmo e do palco.'), kind: 'pick', opts: PALETTES.map(p => [p.id, p.n]) },
  { k: 'skin', t: tt('Visual dos consoles'), d: tt('Cosmo deixa todos os consoles com a cara do app; Clássico imita a tela original de cada console.'), kind: 'pick', opts: [['cosmo', tt('Cosmo')], ['classic', tt('Clássico')]] },
  { k: 'crtLvl', t: tt('Filtro CRT'), d: tt('Linhas e cantos escuros de TV antiga. 0 desliga.'), kind: 'lvl', step: 10 },
  { k: 'flicker', t: tt('Tremulação'), d: tt('A TV pisca de leve de vez em quando.'), kind: 'sw' },
  { k: 'frame', t: tt('Moldura de TV'), d: tt('Cantos arredondados em volta da tela.'), kind: 'sw' },
  { k: 'glow', t: tt('Brilho neon'), d: tt('Brilho em volta dos textos e botões.'), kind: 'sw' },
  { k: 'pixelStage', t: tt('Palco pixelado'), d: tt('Os consoles em baixa resolução, como num jogo antigo.'), kind: 'sw' },
  { k: 'blur', t: tt('Desfocar o palco na Home'), d: tt('O palco fica desfocado atrás do Início.'), kind: 'sw' },
  { k: 'reduce', t: tt('Menos movimento'), d: tt('Sem animações nem tremulação.'), kind: 'sw' },
  { k: 'snd', t: tt('Sons da interface'), d: tt('Bipes ao mover e confirmar.'), kind: 'sw' },
  { k: 'vol', t: tt('Volume'), d: '', kind: 'lvl', step: 10 },
  { k: 'bootSnd', t: tt('Vinheta da abertura'), d: '', kind: 'sw' },
  { k: 'lang', t: tt('Idioma'), d: tt('Automático segue o idioma do Windows.'), kind: 'pick', opts: [['auto', tt('Automático')], ['pt', tt('Português')], ['en', tt('English')]] },
  { k: 'boot', t: tt('Mostrar a abertura'), d: tt('Desligado, o Cosmo abre direto.'), kind: 'sw' },
  { k: 'start', t: tt('Começar em'), d: '', kind: 'pick', opts: [['act', tt('Início')], ['stage', tt('Consoles')]] },
  { k: 'pad', t: tt('Botões na tela'), d: tt('Automático segue o que você usou por último: teclado ou controle.'), kind: 'pick', opts: Object.entries(PAD_NAMES) as [string, string][] },
  { k: 'translate', t: tt('Traduzir textos dos jogos'), d: tt('Descrições e requisitos do catálogo vêm em inglês; o Cosmo traduz pelo MyMemory e guarda.'), kind: 'sw' },
] as Row[]).map(r => [r.k, r]));

const LINUX = navigator.userAgent.includes('Linux');
type Tab = 'Geral' | 'Visual' | 'Áudio' | 'Controle' | 'Jogos' | 'Wine' | 'Sistema' | 'Sobre';
const TABS: Tab[] = LINUX ? ['Geral', 'Visual', 'Áudio', 'Controle', 'Jogos', 'Wine', 'Sistema', 'Sobre'] : ['Geral', 'Visual', 'Áudio', 'Controle', 'Jogos', 'Sistema', 'Sobre'];

export function Settings({ onClose, onPickConsoles, onSupport }: { onClose: () => void; onPickConsoles: () => void; onSupport: () => void }) {
  const s = useSettings();
  const root = useRef<HTMLDivElement>(null);
  const trpc = useTRPC(), qc = useQueryClient();
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const [artStatus, setArtStatus] = useState<string | null>(null);
  const artStatus0 = useQuery(trpc.art.status.queryOptions());
  useSubscription(trpc.art.onStatus.subscriptionOptions(undefined, { onData: d => setArtStatus(d) }));
  const artRefresh = useMutation(trpc.art.refresh.mutationOptions());
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.settings.portsDir.queryKey(), d) }));
  const me = useProfile();
  const quit = useMutation(trpc.system.quit.mutationOptions());
  const openLog = useMutation(trpc.system.openLog.mutationOptions());
  const pad = usePad();
  const binds = useQuery(trpc.ingame.binds.queryOptions());
  const [note, setNote] = useState<[string, string] | null>(null);
  const setBind = useMutation(trpc.ingame.setBind.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.ingame.binds.queryKey(), d) }));
  const askBind = (a: 'summon' | 'shot') => {
    sfx.play('ok'); setNote(null);
    void recordButtons(BIND_NAMES()[a], true).then(r => {
      if (!r) return;
      setBind.mutate({ pad: r.pad.id, action: a, bind: tokensOf(r.pad, r.idx) }, { onSuccess: () => { sfx.play('ok'); setNote([a, tt('Atalho salvo.')]); }, onError: e => { sfx.play('back'); setNote([a, e.message]); } });
    });
  };
  const askNav = (k: Key, name: string) => {
    sfx.play('ok'); setNote(null);
    void recordButtons(name).then(r => {
      if (!r) return;
      if (r.idx.length > 1) { sfx.play('back'); setNote([k, tt('Aperte um botão só para esta ação.')]); return; }
      const err = rebind(r.pad, k, r.idx[0]!);
      sfx.play(err ? 'back' : 'ok'); setNote([k, err ?? tt('Botão trocado.')]);
    });
  };
  const kbMode = usePadKind() === 'kb';
  const kb = useKbMap();
  const askKey = (k: Key, name: string) => {
    sfx.play('ok'); setNote(null);
    void recordKey(name, k).then(key => {
      if (!key) return;
      const err = rebindKey(k, key);
      sfx.play(err ? 'back' : 'ok'); setNote([k, err ?? tt('Tecla trocada.')]);
    });
  };
  const keyChips = (k: Key) => { const ks = kb[k] ?? []; return ks.length ? <span className="bind">{ks.map((x, i) => <span key={x} className="bind-k">{i > 0 && <i>/</i>}<span className="gp kb">{keyLabel(x)}</span></span>)}</span> : <span className="gp pill">—</span>; };
  const resetAll = () => { sfx.play('ok'); if (kbMode) { resetKbMap(); setNote(['reset', tt('Teclas de volta ao padrão.')]); return; } if (pad) { resetPadMap(pad.id); setBind.mutate({ pad: pad.id, action: 'shot', bind: null }); } setNote(['reset', tt('Tudo de volta ao padrão.')]); };
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const steamKey = useQuery(trpc.settings.steamKey.queryOptions());
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const saveKey = useMutation(trpc.settings.setSteamKey.mutationOptions({
    onSuccess: k => { qc.setQueryData(trpc.settings.steamKey.queryKey(), k); setKeyDraft(null); setKeyNote(k ? tt('Chave salva. As listas dos jogos da Steam foram buscadas de novo.') : tt('Chave apagada.')); void qc.invalidateQueries({ queryKey: trpc.achievements.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); },
    onError: e => setKeyNote(e.message),
  }));
  const gogQ = useQuery(trpc.settings.gog.queryOptions());
  const gogIn = useMutation(trpc.settings.gogLogin.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.gog.queryKey(), d); void qc.invalidateQueries({ queryKey: trpc.achievements.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); } }));
  const gogOut = useMutation(trpc.settings.gogLogout.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.settings.gog.queryKey(), d) }));
  const gogRow = () => {
    sfx.play('ok');
    if (!gogQ.data?.signedIn) return gogIn.mutate();
    void askConfirm({ title: tt('Sair da conta da GOG?'), text: tt('As conquistas que o Cosmo já viu ficam guardadas.'), ok: tt('Sair'), cancel: tt('Cancelar') }).then(y => { if (y) gogOut.mutate(); });
  };
  const win = useQuery(trpc.win.state.queryOptions());
  useSubscription(trpc.win.onState.subscriptionOptions(undefined, { onData: d => qc.setQueryData(trpc.win.state.queryKey(), d) }));
  const toggleFs = useMutation(trpc.win.toggleFullScreen.mutationOptions());
  const upd = useQuery(trpc.updates.state.queryOptions());
  const check = useMutation(trpc.updates.check.mutationOptions({ onSuccess: d => { if (d) qc.setQueryData(trpc.updates.state.queryKey(), d); } }));
  const install = useMutation(trpc.updates.install.mutationOptions());
  const u = upd.data;
  const updText = !u ? '' : u.status === 'dev' ? tt('Rodando pelo código: a atualização automática só funciona na versão instalada.')
    : u.status === 'off' ? tt('Atualização automática desligada: esta versão não tem um servidor de atualizações configurado.')
    : u.status === 'checking' ? tt('Procurando versão nova…') : u.status === 'downloading' ? tt('Baixando a versão {0} · {1}%', { 0: u.version, 1: u.pct })
    : u.status === 'ready' ? tt('Versão {0} baixada. Enter reinicia e instala.', { 0: u.version }) : u.status === 'error' ? u.error ?? tt('Não deu para verificar agora.')
    : u.status === 'none' ? tt('Você está na versão mais nova.') : tt('O Cosmo procura versões novas sozinho, a cada 6 horas.');
  const bg = useQuery(trpc.background.get.queryOptions());
  const setBg = useMutation(trpc.background.set.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.background.get.queryKey(), d) }));
  const bgRow = (k: 'tray' | 'track' | 'autostart' | 'screen', t: string, d: string) => (
    <button key={k} className="st-r" data-hf data-k={k} onClick={() => { sfx.play('move'); setBg.mutate({ [k]: !bg.data?.[k] }); }}>
      <span><span className="t">{t}</span><span className="d">{d}</span></span>
      <span className="c"><span className={`st-sw ${bg.data?.[k] ? 'f' : ''}`}><i /></span></span>
    </button>
  );

  const change = (r: Row, dir: 1 | -1) => {
    initAudio();
    if (r.kind === 'sw') setSettings({ [r.k]: !s[r.k] } as Partial<S>);
    else if (r.kind === 'lvl') setSettings({ [r.k]: Math.max(0, Math.min(100, (s[r.k] as number) + dir * r.step)) } as Partial<S>);
    else { const i = r.opts.findIndex(o => o[0] === s[r.k]); setSettings({ [r.k]: r.opts[(i + dir + r.opts.length) % r.opts.length]![0] } as Partial<S>); }
    sfx.play('move');
    if (r.k === 'lang') setTimeout(() => location.reload(), 150);
  };
  const rowOf = (el: Element | null) => { const k = (el as HTMLElement | null)?.dataset.k; return k ? ROWS[k] : undefined; };

  const [tab, setTab] = useState<Tab>('Geral');
  const via = useRef<'bar' | 'lb' | null>(null);
  const go = (d: 1 | -1, from: 'bar' | 'lb') => {
    const i = TABS.indexOf(tab) + d; if (i < 0 || i >= TABS.length) return;
    sfx.play('move'); via.current = from; setTab(TABS[i]!);
  };
  const nav = useSpatialNav(root, {
    active: true,
    onKey: (k: Key) => {
      if (k === 'Escape') { sfx.play('back'); onClose(); return true; }
      if (k === 'LB' || k === 'RB') { go(k === 'RB' ? 1 : -1, 'lb'); return true; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const el = root.current?.querySelector<HTMLElement>('[data-on]') ?? null;
        if (el?.dataset.tab) { go(k === 'ArrowRight' ? 1 : -1, 'bar'); return true; }
        if (stepFocused(root.current, k === 'ArrowRight' ? 1 : -1)) return true;
        const r = rowOf(el); if (r) { change(r, k === 'ArrowRight' ? 1 : -1); return true; }
        const bk = el?.dataset.k as 'tray' | 'track' | 'autostart' | 'screen' | 'fs' | undefined;
        if (bk === 'fs') { toggleFs.mutate(); return true; }
        if (bk && bg.data) { sfx.play('move'); setBg.mutate({ [bk]: !bg.data[bk] }); return true; }
      }
    },
  });

  useLayoutEffect(() => {
    const how = via.current; via.current = null;
    const r = root.current; if (!how || !r) return;
    const el = how === 'bar' ? r.querySelector<HTMLElement>(`[data-tab="${tab}"]`) : r.querySelector<HTMLElement>('.st-r');
    if (el) nav.focusEl(el);
  }, [tab]);

  const value = (r: Row): ReactNode => {
    const v = s[r.k];
    if (r.kind === 'sw') return <span className={`st-sw ${v ? 'f' : ''}`}><i /></span>;
    if (r.kind === 'lvl') return <span className="st-seg">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < (v as number) / 10 ? 'f' : ''} />)}</span>;
    const label = r.opts.find(o => o[0] === v)?.[1] ?? String(v);
    const pal = r.k === 'pal' ? paletteById(v as string) : null;
    return <span className="st-pick">‹{pal && <span className="st-pal">{[pal.bg, pal.acc, pal.pink, pal.cyan].map(c => <i key={c} style={{ background: c }} />)}</span>}<b>{label}</b>›</span>;
  };

  const row = (k: string) => { const r = ROWS[k]!; return (
    <button key={r.k} className="st-r" data-hf data-k={r.k} onClick={() => change(r, 1)}>
      <span><span className="t">{r.t}</span>{r.d && <span className="d">{r.d}</span>}</span>
      <span className="c">{value(r)}</span>
    </button>
  ); };

  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-w">
        <header className="st-h"><span className="glow">{tt('CONFIGURAÇÕES')}</span><span className="st-hint"><Glyph a="lb" /><Glyph a="rb" />{tt('seção')}{' '}<Glyph a="ud" />{tt('escolher')}{' '}<Glyph a="lr" />{tt('mudar')}{' '}<Glyph a="back" />{tt('fechar')}</span></header>
        <div className="st-rows" ref={root}>
          <nav className="st-tabs">{TABS.map(x => <button key={x} data-hf data-tab={x} className={x === tab ? 'cur' : ''} onClick={() => { sfx.play('move'); setTab(x); }}>{tt(x)}</button>)}</nav>
          {tab === 'Geral' && <>
                <button className="st-r" data-hf onClick={() => nameRef.current?.focus()}>
                  <span><span className="t">{tt('Seu nome')}</span><span className="d">{tt('Aparece no perfil e nos consoles. Em branco, o Cosmo usa o nome do Windows.')}</span></span>
                  <span className="c"><span className="st-av" style={{ background: me.color }}>{me.initial}</span>
                    <SearchBox ref={nameRef} value={s.name} onChange={v => setSettings({ name: v.slice(0, 24) })} placeholder={me.suggested || tt('Jogador')} nav={false} className="st-name" /></span>
                </button>
            {row('avatar')}
            {row('lang')}
            {row('start')}
            {row('boot')}
          </>}
          {tab === 'Visual' && <>
            {row('pal')}
            {row('skin')}
            {row('crtLvl')}
            {row('flicker')}
            {row('frame')}
            {row('glow')}
            {row('pixelStage')}
            {row('blur')}
            {row('reduce')}
          </>}
          {tab === 'Áudio' && <>
            {row('snd')}
            {row('vol')}
            {row('bootSnd')}
          </>}
          {tab === 'Controle' && <>
            {row('pad')}
          {pad && <>
            <div className="st-sec">{tt('TESTE DO CONTROLE')}</div>
            <PadTester />
            <p className="st-note">{tt('Aperte os botões do controle: cada um que o Windows mostra para os programas acende aqui, e só esses podem ser usados. Alguns controles escondem os botões extras no modo Xbox (XInput); no 8BitDo Ultimate 2, por exemplo, L4/R4 e as palhetas de trás só aparecem no modo Bluetooth (DInput).')}</p>
          </>}
          <div className="st-sec">{kbMode ? tt('TECLAS DO COSMO') : tt('BOTÕES DO COSMO')}</div>
          {kbMode && <p className="st-note">{pad ? tt('Você está no teclado. Aperte qualquer botão do controle para trocar os botões dele.') : tt('Você está no teclado. Para trocar os botões de um controle, conecte ele e aperte qualquer botão.')}</p>}
          {!kbMode && !pad && <p className="st-note">{tt('Conecte um controle e aperte qualquer botão nele para trocar os botões.')}</p>}
          {kbMode && SETUP_STEPS.map(([k, name]) => (
            <button key={k} className="st-r st-bind" data-hf onClick={() => askKey(k, name)}>
              <span><span className="t">{name}</span><span className="d">{note?.[0] === k ? note[1] : tt('Padrão: {0}', { 0: (KB_DEFAULT[k] ?? []).map(keyLabel).join(tt(' ou ')) })}</span></span>
              <span className="c">{keyChips(k)}</span>
            </button>
          ))}
          {!kbMode && SETUP_STEPS.map(([k, name, hint]) => (
            <button key={k} className="st-r st-bind" data-hf disabled={!pad} onClick={() => askNav(k, name)}>
              <span><span className="t">{name}</span><span className="d">{note?.[0] === k ? note[1] : hint}</span></span>
              <span className="c"><PhysGlyph i={buttonOf(pad, k) ?? -1} pad={pad} /></span>
            </button>
          ))}
          <div className="st-sec">{tt('ATALHOS DURANTE O JOGO')}</div>
          {kbMode && <p className="st-note">{tt('No teclado eles são fixos: com um jogo aberto, Home chama o Cosmo e Print Screen tira a captura. Os botões abaixo são do controle.')}</p>}
          {LINUX && <p className="st-note">{tt('No Linux, trazer o Cosmo para a frente e a captura do instante do primeiro botão precisam de uma sessão X11 com o xdotool instalado. No Wayland a captura passa pelo sistema, que pode pedir permissão na primeira vez, e o Cosmo não consegue pegar o foco sozinho.')}</p>}
          {(['summon', 'shot'] as const).map(a => (
            <button key={a} className="st-r st-bind" data-hf disabled={!pad} onClick={() => askBind(a)}>
              <span><span className="t">{BIND_NAMES()[a]}</span><span className="d">{note?.[0] === a ? note[1] : a === 'summon' ? tt('Segure por 1 segundo durante o jogo.') : tt('Aperte durante o jogo. Use botões que o jogo não usa.')}</span></span>
              <span className="c">{binds.data && <BindChips bind={bindsFor(binds.data, pad?.id ?? '')[a]} />}</span>
            </button>
          ))}
          <button className="st-r" data-hf onClick={resetAll}>
            <span><span className="t">{tt('Restaurar o padrão')}</span><span className="d">{note?.[0] === 'reset' ? note[1] : kbMode ? tt('Volta todas as teclas ao original.') : tt('Volta todos os botões e atalhos ao original deste controle.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{tt('Restaurar')}</b>›</span></span>
          </button>
          <p className="st-note">{kbMode ? tt('Enter troca a tecla: aperte a que você quer. Se ela já estiver em outra ação, as duas trocam de lugar. As setas, Tab, Home e os atalhos S, C, M, P e / são fixos.') : tt('Enter troca o botão: aperte no controle o que você quer. Se ele já estiver em outra ação, as duas trocam de lugar.')}</p>
          </>}
          {tab === 'Jogos' && <>
          <button className="st-r" data-hf onClick={() => pickDir.mutate()}>
            <span><span className="t">{tt('Pasta dos jogos')}</span><span className="d">{tt('Onde o Cosmo instala o que você baixa. Jogos já instalados ficam onde estão.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{portsDir.data ?? '…'}</b>›</span></span>
          </button>
            {bg.data && bgRow('screen', tt('Abrir o jogo na tela do Cosmo'), tt('Com mais de um monitor, o jogo vai para a tela onde o Cosmo está. Jogos em tela cheia exclusiva podem ignorar.'))}
            {bg.data && bgRow('track', tt('Contar jogos abertos fora do Cosmo'), tt('Com o Cosmo aberto (ou na bandeja), o tempo conta mesmo se você abrir o jogo pelo .exe ou por um atalho.'))}
            {getLang() === 'pt' && row('translate')}
          <div className="st-sec">{tt('CONQUISTAS')}</div>
          <p className="st-note">{tt('O Cosmo lê as conquistas da Steam deste PC, dos emuladores de Steam (Goldberg, GSE, CODEX, RUNE) e da sua conta da GOG. Só lê: nada é enviado para a Steam nem para a GOG.')}</p>
          <button className="st-r" data-hf onClick={() => keyRef.current?.focus()}>
            <span><span className="t">{tt('Chave da API da Steam')}</span><span className="d">{keyNote ?? tt('Opcional. Serve para buscar nomes e ícones quando a Steam deste PC não tem a lista do jogo. Pegue a sua em steamcommunity.com/dev/apikey.')}</span></span>
            <span className="c"><SearchBox ref={keyRef} value={keyDraft ?? steamKey.data ?? ''} onChange={v => setKeyDraft(v.slice(0, 64))} onDone={() => { if (keyDraft != null) saveKey.mutate({ key: keyDraft }); }} placeholder={tt('Sem chave')} nav={false} className="st-name" /></span>
          </button>
          <button className="st-r" data-hf onClick={gogRow} disabled={gogIn.isPending}>
            <span><span className="t">{tt('Conta da GOG')}</span><span className="d">{gogIn.isPending ? tt('Entre na janela da GOG que abriu…') : gogQ.data?.signedIn ? tt('Conectada{0}. Enter sai da conta.', { 0: gogQ.data.name ? ` (${gogQ.data.name})` : '' }) : tt('Para ver as conquistas dos jogos da GOG. Enter abre o login da GOG.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{gogQ.data?.signedIn ? tt('Sair') : tt('Entrar')}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => artRefresh.mutate()} disabled={artRefresh.isPending}>
            <span><span className="t">{tt('Imagens dos jogos')}</span><span className="d">{artStatus ?? artStatus0.data ?? tt('Capas, fundos e logos do LaunchBox Games Database. Enter baixa o banco de novo e procura as que faltaram.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{artRefresh.isPending ? tt('Atualizando…') : tt('Atualizar')}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); onPickConsoles(); }}>
            <span><span className="t">{tt('Consoles no palco')}</span><span className="d">{tt('Quais aparecem no palco. Os que ficam de fora vão para Outros.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{s.hidden.length ? tt('{0} escondido{1}', { 0: s.hidden.length, 1: s.hidden.length > 1 ? 's' : '' }) : tt('Todos')}</b>›</span></span>
          </button>
          </>}
          {tab === 'Wine' && <>
            <p className="st-note">{tt('Como o Cosmo abre programas do Windows no Linux. Cada jogo ganha o seu prefixo; estas são as opções de todos os jogos, e cada jogo pode ter as suas na página dele.')}</p>
            <WineOptions />
          </>}
          {tab === 'Sistema' && <>
          <button className="st-r" data-hf data-k="fs" onClick={() => toggleFs.mutate()}>
            <span><span className="t">{tt('Tela cheia')}</span><span className="d">{tt('Também com Alt+Enter ou F11. O Cosmo lembra do tamanho e da posição da janela.')}</span></span>
            <span className="c"><span className={`st-sw ${win.data?.fullscreen ? 'f' : ''}`}><i /></span></span>
          </button>
            {bg.data && bgRow('tray', tt('Fechar para a bandeja'), bg.data.trayOk ? tt('O X esconde o Cosmo perto do relógio em vez de fechar. Para sair de vez, use Sair no ícone da bandeja.') : tt('No GNOME o ícone perto do relógio só aparece com a extensão AppIndicator, que não está ligada. Sem ela, o Cosmo some ao fechar e só volta abrindo de novo pelo menu de aplicativos.'))}
            {bg.data && bgRow('autostart', LINUX ? tt('Abrir junto com o sistema') : tt('Abrir com o Windows'), tt('Liga escondido na bandeja quando o computador inicia, pronto para contar o tempo.'))}
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); if (u?.status === 'ready') install.mutate(); else check.mutate(); }}>
            <span><span className="t">{tt('Cosmo {0}', { 0: u ? `v${u.current}` : '' })}</span><span className="d">{updText}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{u?.status === 'ready' ? tt('Reiniciar e atualizar') : check.isPending || u?.status === 'checking' ? tt('Verificando…') : tt('Verificar agora')}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); void askConfirm({ title: tt('Sair do Cosmo?'), text: tt('O Cosmo fecha de vez, sem ficar na bandeja.'), ok: tt('Sair'), cancel: tt('Ficar') }).then(y => { if (y) quit.mutate(); }); }}>
            <span><span className="t">{tt('Sair do Cosmo')}</span><span className="d">{tt('Fecha o app de vez. Também fica no menu do Start/≡ do controle.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>⏻</b>›</span></span>
          </button>
          </>}
          {tab === 'Sobre' && <>
          <button className="st-r st-sup" data-hf onClick={() => { sfx.play('ok'); onSupport(); }}>
            <span><span className="t">{tt('♥ Apoiar o Cosmo')}</span><span className="d">{tt('O Cosmo é de graça e vai continuar sendo. Um café ajuda a manter o catálogo e os hubs em dia.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{tt('☕ Abrir')}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); openLog.mutate(); }}>
            <span><span className="t">{tt('Registro do Cosmo')}</span><span className="d">{tt('Abre a pasta do arquivo cartucho.log. Se algo travar ou der erro, mande esse arquivo junto com o relato.')}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{tt('Abrir pasta')}</b>›</span></span>
          </button>
          <p className="st-credits">{tt('Catálogo: Recompendium (recompendium.com). Imagens: LaunchBox Games Database e loja da Steam. Notas da crítica: Metacritic e OpenCritic via Wikidata, e IGDB.com. Modelos 3D do Sketchfab, de: Laser Design (SNES, CC BY-NC), Joseph Rohm (N64, CC BY), Jeffrey fan 2000 (GameCube, CC BY), elouisetrewartha (Wii, CC BY-NC), Smoggybeard (Switch, CC BY-NC-SA), NAIT Studio (Switch 2, CC BY), ecjhr0awipso (PS1, CC BY), barbi0526 (PS2, CC BY), Ilya Ostrovsky (PSP, CC BY), Vasily (PS3, CC BY), Laxity (PS4, CC BY), DatSketch (PS5, CC BY-ND), A.stark (NES, CC BY), danny_p3d (Game Boy, CC BY-NC), Cianon (DS Lite, CC BY), rubikreef (Xbox, CC BY), synthetic worlds (Mega Drive, CC BY), Rob Bryant, Jr (Xbox 360, CC BY), MadeByYeshe (PC, CC BY), Daniel Brück (fliperama, CC BY). Instalação e atualização adaptadas do Harbour (MIT-0). Atalhos: S configurações, C botões, M som, P paleta, F11 ou Alt+Enter tela cheia.')}</p>
          </>}
        </div>
      </div>
    </div>
  );
}
