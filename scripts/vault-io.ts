import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildVault } from '../src/core/vault';
import type { PublishedData } from '../src/core/types';

/** Replaces outDir with a freshly encrypted vault (old ciphertext is removed so stale files never linger). */
export async function writeVault(data: PublishedData, code: string, outDir: string, iterations?: number) {
  const target = resolve(outDir);
  if (target === resolve('.') || target === resolve('/') || target.split('/').length < 3) throw new Error(`Refusing to replace "${outDir}"`);
  const files = await buildVault(data, code, iterations ? { iterations } : {});
  rmSync(target, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    const file = join(target, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return Object.keys(files).length;
}
