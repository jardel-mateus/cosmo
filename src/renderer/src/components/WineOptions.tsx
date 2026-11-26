import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { sfx } from '../lib/sfx';
import { useProgress } from '../lib/progress';
import { SearchBox } from './SearchBox';
import { ProgressBar } from './ProgressBar';
import { tt } from '@shared/i18n';
import type { RunnerKind, SyncMode } from '@shared/wine';

const RUNNERS: [RunnerKind, string][] = [['auto', tt('Automático')], ['umu', 'umu-launcher'], ['proton', 'Proton'], ['wine', 'Wine']];
const SYNCS: [SyncMode, string][] = [['default', tt('Padrão')], ['esync', 'esync'], ['fsync', 'fsync'], ['none', tt('Desligado')]];

const cycle = <T,>(list: T[], cur: T, dir: number) => list[(Math.max(0, list.indexOf(cur)) + dir + list.length) % list.length]!;

function Row({ t, d, value, onStep, onEnter }: { t: string; d?: ReactNode; value: ReactNode; onStep?: (dir: number) => void; onEnter?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const step = useRef(onStep);
  step.current = onStep;
  useEffect(() => {
    const el = ref.current!, f = (e: Event) => step.current?.((e as CustomEvent<number>).detail);
    el.addEventListener('cyc', f);
    return () => el.removeEventListener('cyc', f);
  }, []);
  return (
    <button ref={ref} className="st-r" data-hf data-cyc={onStep ? '' : undefined} onClick={() => { sfx.play('move'); if (onEnter) onEnter(); else onStep?.(1); }}>
      <span><span className="t">{t}</span>{d && <span className="d">{d}</span>}</span>
      <span className="c"><span className="st-pick">{onStep ? '‹' : ''}<b style={{ minWidth: 0, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</b>›</span></span>
    </button>
  );
}

export function stepFocused(root: HTMLElement | null, dir: 1 | -1) {
  const el = root?.querySelector<HTMLElement>('[data-on]');
  if (el?.dataset.cyc === undefined) return false;
  sfx.play('move');
  el.dispatchEvent(new CustomEvent('cyc', { detail: dir }));
  return true;
}

const envText = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
const parseEnv = (s: string) => Object.fromEntries(s.split(/\s+/).map(x => x.match(/^([A-Za-z_]\w*)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map(m => [m[1]!, m[2]!]));
const parseVerbs = (s: string) => [...new Set(s.split(/[\s,]+/).filter(Boolean))];

export function WineOptions({ id }: { id?: string }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const cfgQ = useQuery(trpc.wine.config.queryOptions({ ...(id ? { id } : {}) }));
  const status = useQuery(trpc.wine.status.queryOptions());
  const versions = useQuery(trpc.wine.versions.queryOptions());
  const remote = useQuery(trpc.wine.remoteBuilds.queryOptions(undefined, { staleTime: 10 * 60_000, retry: false, enabled: !id }));
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.wine.pathKey() }); };
  const save = useMutation(trpc.wine.setConfig.mutationOptions({ onSuccess: refresh }));
  const pickPrefix = useMutation(trpc.wine.pickPrefix.mutationOptions({ onSuccess: refresh }));
  const reset = useMutation(trpc.wine.resetGame.mutationOptions({ onSuccess: refresh }));
  const installBuild = useMutation(trpc.wine.installBuild.mutationOptions({ onSuccess: refresh }));
  const removeBuild = useMutation(trpc.wine.removeBuild.mutationOptions({ onSuccess: refresh }));
  const installUmu = useMutation(trpc.wine.installUmu.mutationOptions({ onSuccess: refresh }));
  const installTricks = useMutation(trpc.wine.installWinetricks.mutationOptions({ onSuccess: refresh }));
  const tricks = useMutation(trpc.wine.winetricks.mutationOptions({ onSuccess: refresh }));
  const openLog = useMutation(trpc.wine.openLog.mutationOptions());
  const setAsk = useMutation(trpc.wine.setAskDownloads.mutationOptions({ onSuccess: refresh }));
  const [pickIdx, setPickIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const prog = useProgress(busy);
  const [env, setEnv] = useState<string | null>(null);
  const [verbs, setVerbs] = useState<string | null>(null);

  const data = cfgQ.data;
  if (!data) return <p className="st-note">{cfgQ.error ? cfgQ.error.message : tt('Carregando…')}</p>;
  const cfg = (id ? data.game : data.global)!, s = status.data, v = versions.data;
  const patch = (p: Record<string, unknown>) => save.mutate({ ...(id ? { id } : {}), patch: p });
  const err = [save, pickPrefix, installBuild, removeBuild, installUmu, installTricks, tricks].map(m => m.error).find(Boolean) ?? remote.error;

  const kinds = cfg.runner === 'wine' ? ['wine'] : cfg.runner === 'auto' ? ['proton', 'wine'] : ['proton'];
  const builds = (s?.builds ?? []).filter(b => kinds.includes(b.kind));
  const buildIds = ['', ...builds.map(b => b.id)];
  const buildName = (bid: string | null) => !bid ? tt('Automática (a mais nova, GE primeiro)') : builds.find(b => b.id === bid)?.name ?? tt('(não encontrada)');
  const dxvkPool = cfg.dxvk.async ? v?.dxvkAsync : v?.dxvk;
  const dxvkList = ['auto', 'off', ...(dxvkPool ?? [])];
  const vkdList = ['off', ...(v?.vkd3d ?? [])];
  const todo = (remote.data ?? []).filter(b => !b.installed);
  const pick = todo[Math.min(pickIdx, Math.max(0, todo.length - 1))];
  const dxLabel = cfg.dxvk.version === 'auto' ? tt('Automático ({0})', { 0: cfg.runner === 'wine' || (cfg.runner === 'auto' && !s?.umu && !builds.some(b => b.kind === 'proton')) ? v?.dxvkDefault ?? '…' : tt('o que vem no Proton') }) : cfg.dxvk.version === 'off' ? tt('Desligado') : cfg.dxvk.version;

  return (
    <>
      {s && <p className="st-note">{[
        `umu-launcher: ${s.umu ?? tt('não instalado')}`,
        `Wine: ${s.wine ?? tt('não instalado')}`,
        `winetricks: ${s.winetricks ?? tt('não instalado')}`,
        `Vulkan: ${s.vulkan.apiVersion ?? tt('não consegui ler')}${s.vulkan.supports14 === false ? tt(' (abaixo do 1.4: o DXVK 3.0 em diante não roda, o Cosmo usa o 2.x)') : ''}`,
      ].join(' · ')}</p>}
      {id && data.override && Object.keys(data.override).length > 0 && <Row t={tt('Voltar ao padrão')} d={tt('Apaga as opções só deste jogo e usa as de Configurações > Wine.')} value={tt('Restaurar')} onEnter={() => reset.mutate({ id })} />}

      <Row t={tt('Rodar com')} d={tt('Automático tenta umu-launcher, Proton e Wine, nessa ordem.')} value={RUNNERS.find(r => r[0] === cfg.runner)![1]}
        onStep={d => patch({ runner: cycle(RUNNERS.map(r => r[0]), cfg.runner, d) })} />
      <Row t={tt('Versão do Proton/Wine')} d={tt('Proton-GE, Proton-CachyOS e Wine do Kron4ek que você baixou, mais os que já estão no sistema e na Steam.')} value={buildName(cfg.runnerBuild)}
        onStep={d => patch({ runnerBuild: cycle(buildIds, cfg.runnerBuild ?? '', d) || null })} />
      {id && <Row t={tt('Prefixo do Wine')} d={tt('Cada jogo tem o seu. Enter escolhe uma pasta de prefixo que você já tem; o Cosmo nunca apaga um prefixo escolhido por você.')}
        value={cfg.prefixPath ?? tt('Do Cosmo')} onEnter={() => pickPrefix.mutate({ id })} />}
      {id && cfg.prefixPath && <Row t={tt('Usar o prefixo do Cosmo')} value={tt('Voltar')} onEnter={() => patch({ prefixPath: null })} />}

      <Row t="DXVK" d={tt('Direct3D 8/9/10/11 pelo Vulkan. No Wine puro é obrigatório. No Proton, escolher uma versão põe o DXVK ao lado do .exe.')} value={dxLabel}
        onStep={d => patch({ dxvk: { version: cycle(dxvkList, cfg.dxvk.version, d) } })} />
      <Row t={tt('DXVK async')} d={tt('Compila shaders em segundo plano (dxvk-gplasync). Evita engasgos, mas pode dar problema com anti-cheat.')} value={cfg.dxvk.async ? tt('Ligado') : tt('Desligado')}
        onStep={() => patch({ dxvk: { async: !cfg.dxvk.async, version: cfg.dxvk.version === 'auto' || cfg.dxvk.version === 'off' ? cfg.dxvk.version : 'auto' } })} />
      <Row t="VKD3D-Proton" d={tt('Direct3D 12 pelo Vulkan, para jogos que usam DX12.')} value={cfg.vkd3d.version === 'off' ? tt('Desligado') : cfg.vkd3d.version}
        onStep={d => patch({ vkd3d: { version: cycle(vkdList, cfg.vkd3d.version, d) } })} />
      <Row t={tt('Sincronização')} d={tt('esync/fsync aceleram jogos em vários núcleos. Desligue só se o jogo travar.')} value={SYNCS.find(x => x[0] === cfg.sync)![1]}
        onStep={d => patch({ sync: cycle(SYNCS.map(x => x[0]), cfg.sync, d) })} />

      <button className="st-r" data-hf onClick={e => (e.currentTarget.querySelector('input'))?.focus()}>
        <span><span className="t">{tt('Variáveis de ambiente')}</span><span className="d">{tt('CHAVE=valor separados por espaço. Ex.: MANGOHUD=1 PROTON_ENABLE_WAYLAND=1')}</span></span>
        <span className="c"><SearchBox value={env ?? envText(cfg.env)} onChange={setEnv} onDone={() => { if (env !== null) patch({ env: parseEnv(env) }); setEnv(null); }} placeholder={tt('CHAVE=valor')} nav={false} className="st-name" /></span>
      </button>
      <button className="st-r" data-hf onClick={e => (e.currentTarget.querySelector('input'))?.focus()}>
        <span><span className="t">{tt('Componentes do winetricks')}</span><span className="d">{tt('Ex.: vcrun2022 dotnet48 corefonts. Instalados uma vez por prefixo, antes de abrir o jogo.')}</span></span>
        <span className="c"><SearchBox value={verbs ?? cfg.winetricks.join(' ')} onChange={setVerbs} onDone={() => { if (verbs !== null) patch({ winetricks: parseVerbs(verbs) }); setVerbs(null); }} placeholder="vcrun2022" nav={false} className="st-name" /></span>
      </button>
      {id && cfg.winetricks.length > 0 && <Row t={tt('Instalar agora')} d={tt('Roda o winetricks neste prefixo sem abrir o jogo.')} value={tricks.isPending ? tt('Instalando…') : tt('Instalar')}
        onEnter={() => { if (!tricks.isPending) tricks.mutate({ id, verbs: cfg.winetricks }); }} />}

      {!id && <>
        <Row t={tt('Perguntar antes de baixar')} d={tt('Antes de abrir um jogo, o Cosmo avisa o que precisa baixar (Proton-GE, DXVK, componentes do winetricks) e espera você permitir.')} value={data.askDownloads ? tt('Ligado') : tt('Desligado')}
          onStep={() => setAsk.mutate({ on: !data.askDownloads })} />
        <Row t={tt('Baixar Proton/Wine')} d={todo.length ? tt('Enter troca a versão, a linha de baixo baixa.') : remote.isLoading ? tt('Procurando versões…') : tt('Nada novo para baixar (ou sem internet).')}
          value={pick ? `${pick.name}${pick.family === 'ge' ? ' · GE' : pick.family === 'cachyos' ? ' · CachyOS' : ' · Wine'}${pick.size ? ` · ${Math.round(pick.size / 1048576)} MB` : ''}` : '—'} onStep={todo.length ? d => setPickIdx(i => (i + d + todo.length) % todo.length) : undefined} />
        {pick && <Row t={tt('Baixar {0}', { 0: pick.name })} value={installBuild.isPending ? tt('Baixando…') : tt('Baixar')} onEnter={() => { if (!installBuild.isPending) { setBusy(`wine:${pick.name}`); installBuild.mutate({ id: pick.id }); } }} />}
        {builds.filter(b => b.where === 'cartucho').map(b => (
          <Row key={b.id} t={tt('Apagar {0}', { 0: b.name })} d={tt('Só os que o Cosmo baixou.')} value={tt('Apagar')} onEnter={() => removeBuild.mutate({ dir: b.id })} />
        ))}
        {s && !s.umu && <Row t={tt('Instalar o umu-launcher')} d={tt('Baixa o umu-launcher (precisa de python3). Sem ele o Cosmo usa o Proton direto ou o Wine.')} value={installUmu.isPending ? tt('Baixando…') : tt('Instalar')} onEnter={() => { setBusy('wine:umu'); installUmu.mutate(); }} />}
        {s && !s.winetricks && <Row t={tt('Instalar o winetricks')} d={tt('Baixa o script do winetricks. Ele ainda precisa de cabextract e unzip no sistema.')} value={installTricks.isPending ? tt('Baixando…') : tt('Instalar')} onEnter={() => { setBusy('wine:winetricks'); installTricks.mutate(); }} />}
        {prog && <ProgressBar p={prog} />}
      </>}
      {id && <Row t={tt('Registro da última execução')} d={data.logFile ?? undefined} value={tt('Abrir pasta')} onEnter={() => openLog.mutate({ id })} />}
      {err && <p className="err" style={{ margin: 0 }}>{err.message}</p>}
    </>
  );
}
