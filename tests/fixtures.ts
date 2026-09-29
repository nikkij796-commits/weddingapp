import { readFileSync } from 'node:fs';
import type { PublishedData } from '../src/core/types';
export const sample = (): PublishedData =>
  JSON.parse(readFileSync(new URL('../data/published.sample.json', import.meta.url), 'utf8'));
