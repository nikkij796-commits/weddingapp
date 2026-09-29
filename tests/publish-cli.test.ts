import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sample } from './fixtures';

const root = process.cwd();
function workspace(content: unknown = sample().content) {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  mkdirSync(join(dir, 'data/raw'), { recursive: true });
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const s = sample();
  writeFileSync(join(dir, 'data/raw/events.json'), JSON.stringify(s.events));
  writeFileSync(join(dir, 'data/raw/content.json'), JSON.stringify(content));
  writeFileSync(join(dir, 'data/raw/guests.csv'), 'Name,Household,Notes,ceremony\nAnn Lee,h1,SECRET NOTE,yes\nBo Lee,h1,,yes\n');
  return dir;
}
const run = (dir: string, code?: string) =>
  spawnSync(join(root, 'node_modules/.bin/tsx'), ['scripts/publish.ts'], { cwd: dir, env: { ...process.env, ...(code ? { WEDDING_CODE: code } : { WEDDING_CODE: '' }) }, encoding: 'utf8' });

describe('publish CLI', () => {
  it('publishes valid raw data and drops private columns', () => {
    const dir = workspace();
    const r = run(dir, 'ABCD1');
    expect(r.status).toBe(0);
    const out = readFileSync(join(dir, 'data/published.json'), 'utf8');
    expect(JSON.parse(out).guests).toHaveLength(2);
    expect(out).not.toContain('SECRET NOTE');
  });
  it('refuses without a code', () => {
    const r = run(workspace());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('WEDDING_CODE');
  });
  it('refuses when raw files are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pub-'));
    mkdirSync(join(dir, 'data/raw'), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
    const r = run(dir, 'ABCD1');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('guests.csv');
  });
  it('blocks and writes nothing when copy mentions private info', () => {
    const c = { ...sample().content, welcome: 'Our budget for this contract is generous' };
    const dir = workspace(c);
    const r = run(dir, 'ABCD1');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/budget/i);
    expect(existsSync(join(dir, 'data/published.json'))).toBe(false);
  });
});
