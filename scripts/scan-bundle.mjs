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
  for (const s of secrets) if (lower.includes(s.toLowerCase())) hits.push(`${f}: contains "${s}"`);
  for (const t of terms) if (new RegExp(`\\b${t}\\b`, 'i').test(lower)) hits.push(`${f}: contains "${t}"`);
}
if (hits.length) {
  console.error('PRIVACY SCAN FAILED\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Privacy scan passed: ${files.length} files, ${secrets.length} secrets checked.`);
