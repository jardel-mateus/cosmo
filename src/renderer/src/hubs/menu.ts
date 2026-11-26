import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isSelfInstall } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { sfx } from '../lib/sfx';
import type { DOpt } from '../components/Discover';
import { uninstallMsg, useHubActions, type HubGame } from './data';
import { tt } from '@shared/i18n';

export function useGameMenu({ show, onInfo, onAch, onRemoved }: { show: (t: string) => void; onInfo: (g: HubGame) => void; onAch?: (g: HubGame) => void; onRemoved?: () => void }) {
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  const options = (x: HubGame, page = false): DOpt[] => {
    const inst = x.installed, self = isSelfInstall(x.console);
    const L: DOpt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: tt('Instalar de novo') });
      L.push({ k: 'relink', l: inst.uninstalled ? tt('Já instalei de novo: mostrar a pasta') : tt('Procurar a pasta') });
      if (inst.adapter && onAch) L.push({ k: 'ach', l: tt('Conquistas') });
      L.push({ k: 'remove', l: tt('Remover da biblioteca') });
    } else if (inst) {
      L.push(inst.running ? { k: 'play', l: tt('Voltar para o jogo') } : inst.exe ? { k: 'play', l: tt('Jogar') } : { k: 'exe', l: tt('Escolher o .exe') });
      if (inst.running) L.push({ k: 'quit', l: tt('Fechar o jogo') });
      if (x.update?.updateAvailable && !self) L.push({ k: 'update', l: tt('Atualizar para {0}', { 0: x.update.latest?.tag }) });
      if (inst.adapter && onAch) L.push({ k: 'ach', l: tt('Conquistas') });
      L.push({ k: 'folder', l: tt('Abrir pasta') });
      if (inst.exe) L.push({ k: 'exe', l: tt('Trocar o .exe') });
      if (!inst.running) L.push({ k: 'uninstall', l: tt('Desinstalar') }, { k: 'remove', l: tt('Remover da biblioteca') });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: tt('Instalar') });
      L.push({ k: 'add', l: self ? tt('Já instalei: adicionar pasta') : tt('Escolher pasta') });
    }
    if (x.repo) L.push({ k: 'gh', l: tt('Ver no GitHub') });
    if (!page) L.push({ k: 'info', l: tt('Página do jogo') });
    return L;
  };

  const run = (k: string, x: HubGame) => {
    if (k === 'quit') { act.quit(x); sfx.play('back'); show(tt('Fechando {0}…', { 0: x.title })); return; }
    if (k === 'play' || k === 'install') {
      const r = act.primary(x);
      sfx.play('ok');
      if (r === 'play') show(tt('{0} aberto', { 0: x.title }));
      else if (r === 'install') show(tt('Baixando {0}…', { 0: x.repo }));
      else if (r === 'pick') chooseExe.mutate({ id: x.installed!.id });
      else if (r === 'relink') show(tt('Escolha onde o jogo está agora'));
      return;
    }
    sfx.play('ok');
    if (k === 'add') { act.addFolder(x); return show(tt('Escolha a pasta do jogo')); }
    if (k === 'reinstall') { act.reinstall(x); return show(tt('Baixando {0} de novo…', { 0: x.repo })); }
    if (k === 'relink') { act.relink(x); return show(tt('Escolha onde o jogo está agora')); }
    if (k === 'uninstall') { void act.uninstall(x).then(r => { if (!r) return; onRemoved?.(); show(uninstallMsg(r, x.title)); }); return; }
    if (k === 'remove') { void act.remove(x).then(ok => { if (!ok) return; onRemoved?.(); show(tt('{0} saiu da biblioteca', { 0: x.title })); }); return; }
    if (k === 'update') { act.update(x); return show(tt('Atualizando para {0}…', { 0: x.update?.latest?.tag })); }
    if (k === 'ach') return onAch?.(x);
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return onInfo(x);
  };

  return { options, run, error: act.error, reset: act.reset };
}
