import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shared = new URL('../src/shared/', import.meta.url);

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@shared/')) spec = new URL(spec.slice(8), shared).href;
  else if (!/^[./]/.test(spec)) return next(spec, ctx);
  if (/\.[cm]?[jt]sx?$/.test(spec)) return next(spec, ctx);
  const base = new URL(spec, ctx.parentURL ?? import.meta.url);
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    const u = new URL(base.href + ext);
    if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
  }
  return next(spec, ctx);
}
