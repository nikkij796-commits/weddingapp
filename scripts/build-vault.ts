/**
 * Build an encrypted vault from a published-data JSON file.
 *   tsx scripts/build-vault.ts <published.json> <outDir> <code> [iterations]
 * Used by `publish:data` and by the e2e web server (sample data in .e2e/vault).
 */
import { readFileSync } from 'node:fs';
import type { PublishedData } from '../src/core/types';
import { writeVault } from './vault-io';

const [dataPath, outDir, code, iter] = process.argv.slice(2);
if (!dataPath || !outDir || !code) {
  console.error('usage: tsx scripts/build-vault.ts <published.json> <outDir> <code> [iterations]');
  process.exit(1);
}
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as PublishedData;
const n = await writeVault(data, code, outDir, iter ? Number(iter) : undefined);
console.log(`Vault: ${n} files -> ${outDir}`);
