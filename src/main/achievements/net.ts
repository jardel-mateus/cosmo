/** O que os leitores de conquistas que vão à internet precisam do resto do Cosmo. */
export type Fetch = (url: string, init?: { headers?: Record<string, string>; method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

export interface AchNet {
  fetch: Fetch | null;
  /** Chave da Web API da Steam que a pessoa colocou nas configurações (opcional). */
  steamKey: () => string | null;
  /** Token da GOG, renovado se precisar. */
  gogToken: () => Promise<{ token: string; userId: string } | null>;
  lang: () => 'pt' | 'en';
}

export const achNet: AchNet = { fetch: null, steamKey: () => null, gogToken: async () => null, lang: () => 'pt' };
export const setAchNet = (p: Partial<AchNet>) => Object.assign(achNet, p);

/** Baixa imagens (ícones) com poucas conexões ao mesmo tempo; falhas viram ausência de ícone. */
export async function fetchImages(urls: Map<number, string>, max = 6): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>(), f = achNet.fetch;
  if (!f) return out;
  const q = [...urls];
  await Promise.all(Array.from({ length: Math.min(max, q.length) }, async () => {
    for (let it = q.shift(); it; it = q.shift()) {
      try { const r = await f(it[1], { signal: AbortSignal.timeout(15_000) }); if (r.ok) out.set(it[0], new Uint8Array(await r.arrayBuffer())); } catch { }
    }
  }));
  return out;
}

export async function getText(url: string, headers?: Record<string, string>): Promise<string> {
  const f = achNet.fetch;
  if (!f) throw new Error('sem acesso à internet');
  const r = await f(url, { headers: headers ?? {}, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

export async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const f = achNet.fetch;
  if (!f) throw new Error('sem acesso à internet');
  const r = await f(url, { headers: headers ?? {}, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json() as T;
}
