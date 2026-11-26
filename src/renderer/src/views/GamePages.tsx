import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Hints } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { useProgress } from '../lib/progress';
import { ago, fmtDate, fmtPlay, fmtSize, plural } from '../lib/format';
import { sfx } from '../lib/sfx';
import { GameArt } from '../components/GameArt';
import { Bars } from '../components/Bars';
import { ProgressBar } from '../components/ProgressBar';
import { WineDialog } from '../components/WineDialog';
import { Translated } from '../components/Translated';
import { tt } from '@shared/i18n';
import { useHubActions, useRemoveGame, type HubGame } from '../hubs/data';

const gh = (repo: string) => window.open(`https://github.com/${repo}`, '_blank');
const LINUX = navigator.userAgent.includes('Linux');

export function GamePage({ id, active, onBack, onAchievements }: { id: string; active: boolean; onBack: () => void; onAchievements: () => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const game = useQuery(trpc.games.get.queryOptions({ id }));
  const stats = useQuery(trpc.play.stats.queryOptions({ id }));
  const upd = useQuery(trpc.ports.checkUpdate.queryOptions({ id }, { enabled: !!game.data?.sourceRepo, staleTime: 5 * 60_000 }));
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); };
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: refresh }));
  const quit = useMutation(trpc.play.quit.mutationOptions());
  const resume = useMutation(trpc.ingame.back.mutationOptions());
  const update = useMutation(trpc.ports.update.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.ports.checkUpdate.queryKey({ id }), d); refresh(); } }));
  const recheck = useMutation({ mutationFn: () => qc.fetchQuery(trpc.ports.checkUpdate.queryOptions({ id, force: true }, { staleTime: 0 })), onSuccess: d => qc.setQueryData(trpc.ports.checkUpdate.queryKey({ id }), d) });
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: refresh }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());
  const removeAsk = useRemoveGame();
  const uninstall = useMutation(trpc.ports.uninstall.mutationOptions({ onSuccess: () => { void qc.invalidateQueries(); onBack(); } }));
  const progress = useProgress(id);
  const [more, setMore] = useState(false);
  const [wineOpen, setWineOpen] = useState(false);
  const relink = useMutation(trpc.games.relink.mutationOptions({ onSuccess: refresh }));
  const reinstall = useMutation(trpc.ports.install.mutationOptions({ onSuccess: refresh }));
  const hub = useHubActions();

  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); onBack(); return true; } } });

  const g = game.data;
  if (!g) return <p className="dim pad24">{game.error ? game.error.message : tt('Carregando…')}</p>;
  const u = upd.data, a = g.achievements, st = stats.data;
  const err = play.error ?? update.error ?? uninstall.error ?? (hub.error ? new Error(hub.error) : null) ?? chooseExe.error ?? quit.error ?? relink.error ?? reinstall.error;
  const canReinstall = !!g.catalogId && !!g.sourceRepo && !isSelfInstall(g.console);
  const isWindowsProgram = LINUX && !!g.exe && /\.(exe|bat|cmd|lnk)$/i.test(g.exe);

  return (
    <div ref={root} className="gp-page">
      <header className="chub-top">
        <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>{tt('◀ VOLTAR')}</button>
        <span className="grow" />
      </header>
      <div className="gp-body">
        <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} className="gp-cover" />
        <div className="gp-main">
          <span className="k">{CONSOLE_NAME[g.console].toUpperCase()}{g.version ? ` · ${g.version}` : ''}{g.running ? tt(' · JOGANDO AGORA') : ''}</span>
          <h1>{g.title}</h1>
          <p className="dim">{g.playMs ? tt('{0} jogadas', { 0: fmtPlay(g.playMs) }) : tt('Ainda não jogado pelo Cosmo')}{g.lastPlayed ? ` · ${ago(g.lastPlayed)}` : ''}{a && a.total ? tt(' · {0}/{1} conquistas', { 0: a.unlocked, 1: a.total }) : ''}</p>

          {g.missing && <p className="warn">{g.uninstalled
            ? tt('Desinstalado. O tempo de jogo e as conquistas ficam guardados; se você instalar de novo, o Cosmo reconhece o jogo e continua de onde parou.')
            : tt('A pasta do jogo não foi encontrada em {0}. {1} O tempo de jogo e as conquistas ficam guardados.', { 0: g.installDir, 1: canReinstall ? tt('Instale de novo ou mostre onde ele está agora.') : tt('Mostre onde ele está agora.') })}</p>}
          {g.missing ? (
            <div className="hm-btns">
              {canReinstall && <button className="hm-go" data-hf data-main disabled={reinstall.isPending || !!progress} onClick={() => { sfx.play('ok'); reinstall.mutate({ catalogId: g.catalogId! }); }}>{tt('⬇ INSTALAR DE NOVO')}</button>}
              <button className={`hm-go ${canReinstall ? 'ghost' : ''}`} data-hf data-main={canReinstall ? undefined : true} disabled={relink.isPending} onClick={() => relink.mutate({ id })}>{g.uninstalled ? tt('JÁ INSTALEI: MOSTRAR A PASTA') : tt('PROCURAR A PASTA')}</button>
              <button className="hm-go ghost" data-hf onClick={() => { void removeAsk(g, g.title).then(ok => { if (ok) onBack(); }); }}>{tt('REMOVER DA BIBLIOTECA')}</button>
            </div>
          ) : (
          <div className="hm-btns">
            {g.running
              ? <><button className="hm-go" data-hf data-main onClick={() => { sfx.play('ok'); resume.mutate(); }}>{tt('▶ VOLTAR PARA O JOGO')}</button><button className="hm-go ghost" data-hf onClick={() => { sfx.play('back'); quit.mutate({ id }); }}>{tt('■ FECHAR O JOGO')}</button></>
              : g.exe
                ? <button className="hm-go" data-hf data-main disabled={play.isPending || !!progress} onClick={() => { sfx.play('ok'); play.mutate({ id }); }}>{tt('▶ JOGAR')}</button>
                : <button className="hm-go" data-hf data-main onClick={() => chooseExe.mutate({ id })}>{tt('ESCOLHER O .EXE')}</button>}
            {g.adapter && <button className="hm-go ghost" data-hf onClick={() => { sfx.play('ok'); onAchievements(); }}>{tt('★ CONQUISTAS{0}', { 0: a?.total ? ` ${a.unlocked}/${a.total}` : '' })}</button>}
            {u?.updateAvailable && !progress && <button className="hm-go ghost upd" data-hf disabled={update.isPending || g.running} onClick={() => update.mutate({ id })}>{tt('⬇ ATUALIZAR PARA {0}', { 0: u.latest?.tag })}</button>}
            <button className="hm-go ghost" data-hf onClick={() => setMore(m => !m)}>⋯</button>
          </div>
          )}

          {more && (
            <div className="gp-more">
              <button className="btn" data-hf onClick={() => chooseExe.mutate({ id })}>{tt('Escolher o .exe')}</button>
              <button className="btn" data-hf onClick={() => openFolder.mutate({ id })}>{tt('Abrir pasta')}</button>
              {isWindowsProgram && <button className="btn" data-hf onClick={() => setWineOpen(o => !o)}>{tt('Opções do Wine')}</button>}
              {g.sourceRepo && <button className="btn" data-hf onClick={() => gh(g.sourceRepo!)}>{tt('Projeto no GitHub')}</button>}
              {!g.running && <button className="btn danger" data-hf onClick={() => { void hub.uninstall({ installed: g, title: g.title } as HubGame).then(r => { if (r) onBack(); }); }}>{tt('Desinstalar')}</button>}
              <button className="btn" data-hf onClick={() => { void removeAsk(g, g.title).then(ok => { if (ok) onBack(); }); }}>{tt('Remover da biblioteca')}</button>
            </div>
          )}

          {wineOpen && <WineDialog id={id} title={g.title} onClose={() => setWineOpen(false)} />}

          {progress && <ProgressBar p={progress} />}
          {err && <p className="err" style={{ margin: 0 }}>{err.message}</p>}

          <div className="gp-cards">
            <section className="gp-card">
              <h3>{tt('TEMPO DE JOGO')}</h3>
              <div className="hm-big glow">{fmtPlay(st?.totalMs ?? 0)}<small>{st?.sessions ? tt('{0} · última {1}', { 0: plural(st.sessions, tt('sessão'), tt('sessões')), 1: ago(st.lastPlayed!) }) : tt('conta a partir da primeira vez que você jogar pelo Cosmo')}</small></div>
              {st && <Bars days={st.days} />}
            </section>
            <section className="gp-card">
              <h3>{tt('VERSÃO')}</h3>
              {isSelfInstall(g.console) ? <p className="dim">{tt('Neste console as atualizações são por sua conta: instale a versão nova por cima da pasta do jogo.')}</p> : !g.sourceRepo ? <p className="dim">{tt('Sem projeto do GitHub ligado, então o Cosmo não procura atualizações.')}</p> : (
                <>
                  <p>{u?.installed ? <>{tt('Instalada:')}{' '}<b>{u.installed}</b></> : tt('Versão instalada desconhecida')}{u?.latest ? <>{' '}{tt('· mais nova:')}{' '}<b>{u.latest.tag}</b>{u.latest.date ? ` (${fmtDate(Date.parse(u.latest.date))})` : ''}</> : null}</p>
                  <p className="dim">
                    {u?.updateAvailable === false ? tt('Você está na versão mais nova.') : u?.updateAvailable ? tt('Atualização de {0}.', { 0: fmtSize(u.latest!.size) }) : u?.installed === null && u?.latest ? tt('Atualizar baixa a versão mais nova e passa a acompanhar.') : ''}
                    {u?.error ? ` ${u.error}` : ''}
                  </p>
                  {u?.updateAvailable === null && u.latest && !progress && <button className="btn" data-hf onClick={() => update.mutate({ id })}>{tt('Baixar {0} por cima', { 0: u.latest.tag })}</button>}
                  <p className="dim small">{u?.checkedAt ? tt('Conferido {0} · ', { 0: ago(u.checkedAt) }) : ''}<button className="link" data-hf disabled={recheck.isPending} onClick={() => recheck.mutate()}>{recheck.isPending ? 'conferindo…' : tt('conferir agora')}</button></p>
                  {u?.latest?.notes && u.updateAvailable && <pre className="notes">{u.latest.notes}</pre>}
                </>
              )}
            </section>
          </div>
          <p className="credit" style={{ padding: 0 }}>{g.installDir}{g.exe ? ` · ${g.exe.split(/[\\/]/).pop()}` : ''}</p>
        </div>
      </div>
      <Hints items={[['ok', tt('Escolher')], ['back', tt('Voltar')]]} />
    </div>
  );
}

export function CatalogPage({ game: c, installedId, active, onBack, onOpenInstalled }: { game: CatalogGame; installedId: string | null; active: boolean; onBack: () => void; onOpenInstalled: (id: string) => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const install = useMutation(trpc.ports.install.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); sfx.play('ok'); onOpenInstalled(g.id); } }));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); if (g) { sfx.play('ok'); onOpenInstalled(g.id); } } }));
  const self = isSelfInstall(c.console);
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const progress = useProgress(c.id);
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); onBack(); return true; } } });

  return (
    <div ref={root} className="gp-page">
      <header className="chub-top">
        <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>{tt('◀ VOLTAR')}</button>
        <span className="grow" />
      </header>
      <div className="gp-body">
        <GameArt title={c.title} console={c.console} platformName={c.platformName} fallback={c.coverUrl} className="gp-cover" />
        <div className="gp-main">
          <span className="k">{(c.platformName || CONSOLE_NAME[c.console]).toUpperCase()}{c.year ? ` · ${c.year}` : ''}{c.developer ? ` · ${c.developer}` : ''}</span>
          <h1>{c.title}</h1>
          <p><span className={`st-${c.status}`}>■ {STATUS_LABEL[c.status]}</span>{c.version ? ` · ${c.version}` : ''}{c.stars ? ` · ★ ${c.stars}` : ''}{c.noLink && !self ? tt(' · sem link no Recompendium') : ''}</p>
          <div className="hm-btns">
            {installedId
              ? <button className="hm-go" data-hf data-main onClick={() => onOpenInstalled(installedId)}>{tt('NA BIBLIOTECA ▶')}</button>
              : <>
                  {c.repo && !self && <button className="hm-go" data-hf data-main disabled={install.isPending || !!progress} onClick={() => { sfx.play('ok'); install.mutate({ catalogId: c.id }); }}>{tt('⬇ INSTALAR')}</button>}
                  <button className={`hm-go ${c.repo && !self ? 'ghost' : ''}`} data-hf data-main={c.repo && !self ? undefined : true} disabled={add.isPending || !!progress}
                    onClick={() => add.mutate({ catalogId: c.id })}>{self ? tt('JÁ INSTALEI: ADICIONAR PASTA') : tt('ESCOLHER PASTA')}</button>
                </>}
            {c.repo && <button className="hm-go ghost" data-hf onClick={() => gh(c.repo!)}>{tt('VER NO GITHUB')}</button>}
          </div>
          {progress && <ProgressBar p={progress} />}
          {(install.error ?? add.error) && !progress && <p className="err" style={{ margin: 0 }}>{(install.error ?? add.error)!.message}</p>}
          {!installedId && self && <p className="dim small">{SELF_INSTALL_NOTE}</p>}
          {!installedId && !self && <p className="dim small">
            {c.repo ? <>{tt('Instalar baixa para {0} (dá para mudar nas configurações); o download é conferido pelo hash do GitHub e pelo Windows Defender antes de ser aberto.', { 0: portsDir.data ?? '…' })}{' '}</> : null}{tt('Já tem o jogo instalado em outro lugar? Escolher pasta coloca ele na biblioteca ligado a este jogo, sem copiar nada.')}</p>}
          <div className="gp-cards">
            {c.needs && <section className="gp-card"><h3>{tt('O QUE VOCÊ PRECISA')}</h3><p className="txt"><Translated text={c.needs} /></p></section>}
            {c.description && <section className="gp-card wide"><h3>{tt('SOBRE')}</h3><p className="txt"><Translated text={c.description} /></p></section>}
          </div>
          <p className="credit" style={{ padding: 0 }}>{tt('Dados: Recompendium{0}', { 0: c.repo ? ` · ${c.repo}` : '' })}</p>
        </div>
      </div>
      <Hints items={[['ok', tt('Escolher')], ['back', tt('Voltar')]]} />
    </div>
  );
}
