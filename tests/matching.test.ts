import { describe, expect, it } from 'vitest';
import { firstName, levenshtein, matchGuest, normalizeName } from '../src/core/matching';
import { sample } from './fixtures';

const guests = sample().guests;
const id = (input: string) => {
  const r = matchGuest(guests, input);
  return r.kind === 'match' ? r.guest.id : r.kind;
};

describe('normalizeName', () => {
  it('lowercases, trims and collapses whitespace', () => expect(normalizeName('  ALEX   Rivera ')).toBe('alex rivera'));
  it('strips accents', () => expect(normalizeName('María José García')).toBe('maria jose garcia'));
  it('handles Last, First', () => expect(normalizeName('Rivera, Alex')).toBe('alex rivera'));
  it('removes apostrophes of all kinds', () => {
    expect(normalizeName("Taylor O'Brien")).toBe('taylor obrien');
    expect(normalizeName('Taylor O’Brien')).toBe('taylor obrien');
  });
  it('treats hyphens as spaces', () => expect(normalizeName('Anne-Marie Cole')).toBe('anne marie cole'));
  it('returns empty for junk', () => expect(normalizeName(' !!! ')).toBe(''));
});

describe('titles', () => {
  it.each([['Dr. Neel Jain', 'neel jain'], ['Mrs. Kamna Jain', 'kamna jain'], ['MR Soham Shah', 'soham shah'], ['Ms. Nikita Jain', 'nikita jain']])(
    '%s -> %s', (raw, out) => expect(normalizeName(raw)).toBe(out));
  it('keeps a lone title-like word', () => expect(normalizeName('Dr')).toBe('dr'));
  it('matches with or without the title', () => {
    const gs = [{ id: 'a', name: 'Dr. Neel Jain', aliases: [], householdId: 'h', invited: [] }];
    for (const q of ['Neel Jain', 'dr neel jain', 'Dr. Neel Jain', 'Mr Neel Jain']) expect(matchGuest(gs, q).kind).toBe('match');
  });
});

describe('levenshtein', () => {
  it.each([['', '', 0], ['a', '', 1], ['kitten', 'sitting', 3], ['same', 'same', 0], ['ab', 'ba', 2]])(
    '%s vs %s = %i',
    (a, b, d) => expect(levenshtein(a as string, b as string)).toBe(d),
  );
});

describe('matchGuest', () => {
  it('matches exact name', () => expect(id('Alex Rivera')).toBe('g1'));
  it('is case-insensitive', () => expect(id('aLeX rIvErA')).toBe('g1'));
  it('matches without accents', () => expect(id('Maria Jose Garcia')).toBe('g3'));
  it('matches with accents', () => expect(id('María José García')).toBe('g3'));
  it('matches an alias', () => expect(id('Alexander Rivera')).toBe('g1'));
  it('matches a nickname alias', () => expect(id("Tay O'Brien")).toBe('g4'));
  it('drops middle names', () => expect(id('Maria Garcia')).toBe('g3'));
  it('accepts Last, First', () => expect(id('Rivera, Jordan')).toBe('g2'));
  it('tolerates a one-letter typo', () => expect(id('Alex Riveraa')).toBe('g1'));
  it('tolerates a swapped-letter typo within 2 edits', () => expect(id('Jordan Rivrea')).toBe('g2'));
  it('rejects a single first name (no probing)', () => expect(id('Alex')).toBe('none'));
  it('rejects unknown names', () => expect(id('Zed Nobody')).toBe('none'));
  it('rejects empty input', () => expect(id('')).toBe('none'));
  it('flags ambiguous fuzzy matches (Chen vs Chan)', () => expect(id('Sam Chn')).toBe('ambiguous'));
  it('still resolves exact when near-duplicates exist', () => {
    expect(id('Sam Chen')).toBe('g5');
    expect(id('Sam Chan')).toBe('g6');
  });
  it('does not match wildly different names', () => expect(id('Alexandra Riverton')).toBe('none'));
  it('prefers the closest fuzzy candidate', () => expect(id('Jordan Rivera')).toBe('g2'));
});

describe('firstName for greetings', () => {
  it.each([['Dr. Neel Jain', 'Neel'], ['Mrs. Kamna Jain', 'Kamna'], ['Ms. Nikita Jain', 'Nikita'], ['Mr Soham Shah', 'Soham'], ['dr. anil jain', 'anil'], ['Sam Chen', 'Sam'], ['  María José García', 'María'], ['Dr.', 'Dr.'], ['Mongilalji', 'Mongilalji']])(
    '%s -> %s', (full, first) => expect(firstName(full)).toBe(first));
});
