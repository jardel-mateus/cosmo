import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setExtraCatalogs } from './catalog';

/**
 * fontes.json, na pasta de dados do Cosmo: onde o app busca jogos além do Recompendium.
 * O arquivo é criado vazio na primeira vez, com a explicação dentro.
 */
const TEMPLATE = {
  _ajuda: [
    'Coloque em "catalogos" endereços (https://...) ou caminhos de arquivos .json com mais jogos.',
    'O formato é o mesmo do Recompendium: { "formato": 1, "entradas": [ { "entry": "...", "nombre": "...", "repo": "dono/projeto", "consola": "n64", ... } ] }',
    'Também vale uma lista solta de entradas: [ { ... }, { ... } ].',
    'Depois de salvar, use "Atualizar catálogo" nas configurações (ou reabra o Cosmo).',
  ],
  catalogos: [] as string[],
};

export function sourcesFile(userData: string) { return join(userData, 'fontes.json'); }

export function loadSources(userData: string) {
  const file = sourcesFile(userData);
  let list: string[] = [];
  try {
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(TEMPLATE, null, 2), 'utf8');
    const j = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as { catalogos?: unknown };
    if (Array.isArray(j.catalogos)) list = j.catalogos.filter((s): s is string => typeof s === 'string');
  } catch (e) { console.warn('[fontes.json]', e instanceof Error ? e.message : e); }
  const env = process.env.COSMO_EXTRA_CATALOGS ?? process.env.CARTUCHO_EXTRA_CATALOGS;
  if (env) list.push(...env.split(/[;,]\s*/));
  setExtraCatalogs(list);
  return list;
}
