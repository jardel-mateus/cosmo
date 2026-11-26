import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame, ConsoleId, InstalledGame, PlayStatus, RadarEvent, UpdateInfo } from '@shared/types';
import { useTRPC } from '../trpc';
import { useProgress } from '../lib/progress';
import { isSelfInstall } from '@shared/consoles';
import { askChoice, askConfirm } from '../lib/dialogs';
import { sfx } from '../lib/sfx';
import { useAskDeletePrefix } from '../lib/wine';
import { tt } from '@shared/i18n';
import { orderLibrary } from '@shared/library';

export interface HubGame {
  key: string;
  title: string;
  coverUrl: string | null;
  status: PlayStatus | null;
  installed: InstalledGame | null;
  catalog: CatalogGame | null;
  isNew: boolean;
  update: UpdateInfo | null;
  repo: string | null;
  console: ConsoleId;
  platformName: string | null;
}

const FRESH_MS = 14 * 86400_000;

export function useHubData(scope: ConsoleId | readonly ConsoleId[] | null) {
  const trpc = useTRPC();
  const key = scope == null ? '*' : typeof scope === 'string' ? scope : scope.join(',');
  const set = useMemo(() => (scope == null ? null : new Set<string>(typeof scope === 'string' ? [scope] : scope)), [key]);
  const games = useQuery(trpc.games.list.queryOptions());
  const cat = useQuery(trpc.catalog.list.queryOptions(set == null ? undefined : set.size === 1 ? { console: [...set][0]! } : { consoles: [...set] }));
  const radar = useQuery(trpc.catalog.radar.queryOptions());
  // Desinstalados (e pastas que sumiram) continuam na biblioteca, com tempo de jogo e conquistas; vão para o fim da lista.
  const mine = useMemo(() => (games.data ?? []).filter(g => !set || set.has(g.console)), [games.data, set]);
  const updates = useQueries({ queries: mine.filter(g => g.sourceRepo && !g.missing).map(g => ({ ...trpc.ports.checkUpdate.queryOptions({ id: g.id }), staleTime: 5 * 60_000 })) });
  const updById = new Map(mine.filter(g => g.sourceRepo && !g.missing).map((g, i) => [g.id, updates[i]?.data ?? null]));

  return useMemo(() => {
    const feed: RadarEvent[] = (radar.data ?? []).filter(e => !set || set.has(e.console));
    const fresh = new Set(feed.filter(e => e.kind === 'new' && Date.now() - e.at < FRESH_MS).map(e => e.gameId));
    const byCat = new Map((cat.data ?? []).map(c => [c.id, c]));
    const all: HubGame[] = mine.map(g => {
      const c = g.catalogId ? byCat.get(g.catalogId) ?? null : null;
      return { key: g.id, title: g.title, coverUrl: g.coverUrl ?? c?.coverUrl ?? null, status: c?.status ?? null, installed: g, catalog: c,
        isNew: !!c && fresh.has(c.id), update: updById.get(g.id) ?? null, repo: g.sourceRepo ?? c?.repo ?? null, console: g.console, platformName: c?.platformName ?? null };
    });
    // Jogados recentemente primeiro (parte separada, como na Steam), depois a coleção em ordem alfabética.
    const { list: lib, recent } = orderLibrary(all);
    const have = new Set(mine.map(g => g.catalogId).filter(Boolean));
    const notInstalled: HubGame[] = (cat.data ?? []).filter(c => !have.has(c.id)).map(c => ({
      key: c.id, title: c.title, coverUrl: c.coverUrl, status: c.status, installed: null, catalog: c, isNew: fresh.has(c.id), update: null, repo: c.repo,
      console: c.console, platformName: c.platformName,
    }));
    const catalog = [...lib.filter(g => g.catalog), ...notInstalled].sort((a, b) => Number(b.isNew) - Number(a.isNew) || Number(!!a.installed) - Number(!!b.installed));
    return {
      loading: games.isLoading || cat.isLoading,
      lib,
      /** Quantos dos primeiros de `lib` são os jogados recentemente. */
      recent,
      notInstalled,
      catalog,
      feed,
      withUpdate: lib.filter(g => g.update?.updateAvailable),
      playMs: mine.reduce((s, g) => s + g.playMs, 0),
    };
  }, [mine, cat.data, radar.data, set, cat.isLoading, games.isLoading, updates.map(u => u.dataUpdatedAt).join()]);
}

/** Pergunta: só tirar da biblioteca (guarda o histórico e volta se instalar de novo) ou apagar tudo. Devolve se tirou. */
export function useRemoveGame() {
  const trpc = useTRPC(), qc = useQueryClient();
  const remove = useMutation(trpc.games.remove.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const askPrefix = useAskDeletePrefix();
  return async (inst: InstalledGame, title: string): Promise<boolean> => {
    let saves: string[] = [];
    try { saves = (await qc.fetchQuery(trpc.games.removePlan.queryOptions({ id: inst.id }, { staleTime: 0 }))).saves; } catch { }
    const files = inst.missing ? '' : tt(' Os arquivos do jogo não são apagados.');
    const all = saves.length
      ? tt('Apagar tudo: apaga o tempo de jogo e as conquistas do Cosmo e manda para a Lixeira as pastas de saves e conquistas do crack:\n{0}', { 0: saves.join('\n') })
      : tt('Apagar tudo: apaga o tempo de jogo e as conquistas do Cosmo. Saves que o jogo guarda em outro lugar ficam onde estão.');
    const r = await askChoice({
      title: tt('Remover {0} da biblioteca?', { 0: title }),
      text: `${tt('Só tirar: o jogo some da biblioteca, mas o tempo de jogo e as conquistas ficam guardados e voltam se você instalar de novo.')}\n\n${all}${files}`,
      alt: tt('Só tirar da biblioteca'), ok: tt('Apagar tudo'), cancel: tt('Cancelar'), danger: true,
    });
    if (!r) return false;
    try {
      if (r === 'alt') await remove.mutateAsync({ id: inst.id, keep: true });
      else await remove.mutateAsync({ id: inst.id, saves: saves.length > 0, deletePrefix: await askPrefix(inst.id, title) });
    } catch { return false; }
    return true;
  };
}

export function useHubActions() {
  const trpc = useTRPC(), qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); };
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: refresh }));
  const quit = useMutation(trpc.play.quit.mutationOptions());
  const resume = useMutation(trpc.ingame.back.mutationOptions());
  const install = useMutation(trpc.ports.install.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const update = useMutation(trpc.ports.update.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const relink = useMutation(trpc.games.relink.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const remove = useMutation(trpc.games.remove.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const uninstall = useMutation(trpc.games.uninstall.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const askPrefix = useAskDeletePrefix();
  const checkAll = useMutation({ mutationFn: async (ids: string[]) => { await Promise.all(ids.map(id => qc.fetchQuery(trpc.ports.checkUpdate.queryOptions({ id, force: true }, { staleTime: 0 })))); await qc.invalidateQueries({ queryKey: trpc.ports.checkUpdate.pathKey() }); } });
  const error = play.error ?? install.error ?? update.error ?? quit.error ?? add.error ?? relink.error ?? remove.error ?? uninstall.error;

  const removeAsk = useRemoveGame();
  const removeFlow = (g: HubGame) => (g.installed ? removeAsk(g.installed, g.title) : Promise.resolve(false));

  return {
    error: error?.message ?? null,
    reset: () => { play.reset(); install.reset(); update.reset(); quit.reset(); add.reset(); relink.reset(); uninstall.reset(); },
    primary(g: HubGame): 'play' | 'resume' | 'install' | 'add' | 'pick' | 'relink' | 'none' {
      if (g.installed?.running) { resume.mutate(); return 'resume'; }
      if (g.installed?.missing) {
        if (g.catalog?.repo && !isSelfInstall(g.console)) { install.mutate({ catalogId: g.catalog.id }); return 'install'; }
        relink.mutate({ id: g.installed.id }); return 'relink';
      }
      if (g.installed) { if (!g.installed.exe) return 'pick'; play.mutate({ id: g.installed.id }); return 'play'; }
      if (g.catalog && isSelfInstall(g.console)) { add.mutate({ catalogId: g.catalog.id }); return 'add'; }
      if (g.catalog?.repo) { install.mutate({ catalogId: g.catalog.id }); return 'install'; }
      return 'none';
    },
    quit: (g: HubGame) => { if (g.installed) quit.mutate({ id: g.installed.id }); },
    update: (g: HubGame) => { if (g.installed && !isSelfInstall(g.console)) update.mutate({ id: g.installed.id }); },
    relink: (g: HubGame) => { if (g.installed) relink.mutate({ id: g.installed.id }); },
    remove: removeFlow,
    /** Pergunta e desinstala. Devolve o que aconteceu, ou null se a pessoa desistiu ou deu erro. */
    uninstall: async (g: HubGame): Promise<'done' | 'steam' | 'removed' | null> => {
      const inst = g.installed; if (!inst) return null;
      if (inst.running) { await askConfirm({ title: tt('Feche {0} antes de desinstalar', { 0: g.title }), ok: tt('OK'), cancel: tt('Voltar') }); return null; }
      let plan;
      try { plan = await qc.fetchQuery(trpc.games.uninstallPlan.queryOptions({ id: inst.id }, { staleTime: 0 })); } catch { return null; }
      if (plan.kind === 'blocked') {
        const y = await askConfirm({ title: tt('O Cosmo não vai apagar {0}', { 0: g.title }), text: tt('{0} Se quiser, ele só sai da biblioteca e os arquivos ficam.', { 0: plan.reason }), ok: tt('Continuar'), cancel: tt('Cancelar') });
        if (!y) return null;
        return await removeFlow(g) ? 'removed' : null;
      }
      const kept = tt('O jogo continua na biblioteca com o tempo de jogo e as conquistas; se instalar de novo, o Cosmo reconhece.');
      const what = plan.kind === 'managed' ? tt('Os arquivos que vieram no download são apagados. Saves e configurações que você mudou ficam na pasta.')
        : plan.kind === 'steam' ? tt('A Steam vai abrir e pedir para confirmar.')
        : plan.kind === 'folder' ? tt('A pasta {0} vai para a Lixeira com tudo o que tem dentro, inclusive saves guardados nela. Dá para recuperar pela Lixeira.', { 0: plan.path })
        : tt('O arquivo {0} vai para a Lixeira. Dá para recuperar por lá.', { 0: plan.path });
      const text = `${what}\n\n${kept}`;
      if (!await askConfirm({ title: tt('Desinstalar {0}?', { 0: g.title }), text, ok: tt('Desinstalar'), cancel: tt('Manter'), danger: true })) return null;
      try { await uninstall.mutateAsync({ id: inst.id, deletePrefix: await askPrefix(inst.id, g.title) }); } catch { return null; }
      return plan.kind === 'steam' ? 'steam' : 'done';
    },
    reinstall: (g: HubGame) => { if (g.catalog?.repo) install.mutate({ catalogId: g.catalog.id }); },
    addFolder: (g: HubGame) => { if (g.catalog && !g.installed) add.mutate({ catalogId: g.catalog.id }); },
    github: (g: HubGame) => { if (g.repo) window.open(`https://github.com/${g.repo}`, '_blank'); },
    checkAll: (gs: HubGame[]) => checkAll.mutate(gs.filter(g => g.installed?.sourceRepo).map(g => g.installed!.id)),
    checking: checkAll.isPending,
  };
}

export const uninstallMsg = (r: 'done' | 'steam' | 'removed', title: string) =>
  r === 'steam' ? tt('Confirme na Steam para desinstalar {0}', { 0: title }) : r === 'removed' ? tt('{0} saiu da biblioteca', { 0: title }) : tt('{0} desinstalado · continua na biblioteca', { 0: title });

export const useGameProgress = (g: HubGame | null | undefined) => {
  const a = useProgress(g?.installed?.id), b = useProgress(g?.catalog?.id);
  return a ?? b;
};

export function useFeed(feed: RadarEvent[], showing: boolean) {
  const trpc = useTRPC(), qc = useQueryClient();
  const again = () => void qc.invalidateQueries({ queryKey: trpc.catalog.radar.queryKey() });
  const dismiss = useMutation(trpc.catalog.dismiss.mutationOptions({ onSuccess: again }));
  const seen = useMutation(trpc.catalog.seen.mutationOptions());
  const sent = useRef(new Set<number>());
  const ids = feed.map(f => f.id).join();
  useEffect(() => {
    if (!showing) return;
    const fresh = feed.filter(f => !sent.current.has(f.id)).map(f => f.id);
    if (!fresh.length) return;
    fresh.forEach(i => sent.current.add(i));
    seen.mutate({ ids: fresh });
  }, [showing, ids]);
  return {
    done: (f: RadarEvent | null | undefined) => { if (f) dismiss.mutate({ ids: [f.id] }); },
    drop: (f: RadarEvent | null | undefined) => { if (!f) return false; sfx.play('back'); dismiss.mutate({ ids: [f.id] }); return true; },
    clear: async (list: RadarEvent[] = feed) => {
      if (!list.length) return;
      if (await askConfirm({ title: tt('Limpar as notificações?'), text: tt('{0} da lista. Jogos novos e versões novas que chegarem depois aparecem normalmente.', { 0: list.length === 1 ? tt('A notificação some') : tt('As {0} notificações somem', { 0: list.length }) }), ok: tt('Limpar'), cancel: tt('Cancelar') })) {
        sfx.play('back'); dismiss.mutate({ ids: list.map(f => f.id) });
      }
    },
  };
}
