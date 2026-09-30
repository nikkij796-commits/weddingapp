// Fails if the built client bundle contains guest names, the wedding code, or private-sounding terms.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dataPath = process.env.WEDDING_DATA ?? (existsSync('data/published.json') ? 'data/published.json' : 'data/published.sample.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

function walk(d) {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
if (!existsSync('dist')) {
  console.error('dist/ not found. Run npm run build first.');
  process.exit(1);
}
const files = walk('dist').filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f));
const secrets = [
  data.code,
  ...data.guests.flatMap((g) => [g.name, ...g.aliases]),
  ...data.events.flatMap((e) => [e.venue, e.address]),
].filter((s) => s && s.length >= 4);
const terms = ['budget', 'contract', 'vendor', 'invoice', 'retainer', 'published.json', 'published.sample'];

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const lower = text.toLowerCase();
  const inVault = f.includes('/vault/');
  for (const s of secrets) {
    // Short alphanumeric strings occur by chance in base64 ciphertext; the opacity check below covers the vault.
    if (inVault && s.length < 10 && /^[A-Za-z0-9+/=]+$/.test(s)) continue;
    if (lower.includes(s.toLowerCase())) hits.push(`${f}: contains "${s}"`);
  }
  for (const t of terms) if (new RegExp(`\\b${t}\\b`, 'i').test(lower)) hits.push(`${f}: contains "${t}"`);
}
// The vault must be opaque: every data string is long base64, never readable text.
const vaultFiles = files.filter((f) => f.includes('/vault/') && !f.endsWith('manifest.json'));
const walkStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walkStrings(x, out));
  return out;
};
for (const f of vaultFiles) {
  let json;
  try { json = JSON.parse(readFileSync(f, 'utf8')); } catch { hits.push(`${f}: not valid JSON`); continue; }
  for (const s of walkStrings(json)) {
    if (s.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(s)) { hits.push(`${f}: contains a value that is not ciphertext ("${s.slice(0, 20)}")`); break; }
  }
}
if (data && !vaultFiles.length) console.warn('note: no vault files in dist (fine for sample builds)');

if (hits.length) {
  console.error('PRIVACY SCAN FAILED\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Privacy scan passed: ${files.length} files (${vaultFiles.length} vault files verified opaque), ${secrets.length} secrets checked.`);
