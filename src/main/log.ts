import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

let file = '';

export function initLog(dir: string) {
  file = join(dir, 'cartucho.log');
  try { if (statSync(file).size > 1_000_000) renameSync(file, `${file}.1`); } catch { }
}

export function log(...parts: unknown[]) {
  if (!file) return;
  const text = parts.map(x => (x instanceof Error ? x.stack ?? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { appendFileSync(file, `${new Date().toISOString()} ${text}\n`); } catch { }
}

export const logFile = () => file;
