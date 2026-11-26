import { afterEach, describe, expect, it, vi } from 'vitest';

describe('clique nos jogos', async () => {
  const { tileClick, semArquivos } = await import('../src/shared/gameclick');
  afterEach(() => vi.useRealTimers());
  const game = (installed: object | null) => ({ key: 'k', title: 'T', installed } as never);
  const ev = (detail: number) => ({ detail, clientX: 10, clientY: 20 } as never);
  const spies = () => ({ select: vi.fn(), page: vi.fn(), play: vi.fn() });

  it('instalado: um clique abre a página, dois cliques jogam (sem abrir a página)', () => {
    vi.useFakeTimers();
    const a = spies(), g = game({ missing: false });
    tileClick(ev(1), g, a);
    vi.advanceTimersByTime(300);
    expect(a.page).toHaveBeenCalledTimes(1);
    const b = spies();
    tileClick(ev(1), g, b); tileClick(ev(2), g, b);
    vi.advanceTimersByTime(300);
    expect(b.play).toHaveBeenCalledTimes(1);
    expect(b.page).not.toHaveBeenCalled();
  });

  it('desinstalado e do catálogo abrem a página com um clique só', () => {
    const a = spies();
    tileClick(ev(1), game({ missing: true, uninstalled: true }), a);
    expect(a.page).toHaveBeenCalledTimes(1);
    const b = spies();
    tileClick(ev(2), game(null), b);
    expect(b.page).toHaveBeenCalledTimes(1);
    expect(b.play).not.toHaveBeenCalled();
    expect(semArquivos(game({ missing: true }))).toBe(true);
    expect(semArquivos(game(null))).toBe(false);
  });
});
