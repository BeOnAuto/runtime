import { describe, expect, it } from 'vitest';

import { matchesKeyPattern } from '../index.ts';
import { problemsOf } from '../testing/entry-problems.ts';
import { tracker } from '../testing/fixture-providers.ts';

const [aKey] = tracker.credentials;

function patternProblemsOf(pattern: string) {
  return problemsOf({ ...tracker, credentials: [{ ...aKey, example: 'trk_…', pattern }] });
}

const keyPatternShape =
  'Expected a regular expression from ^ to $ of characters and character classes, such as [A-Za-z0-9], \\d, \\w and ., each repeated with ?, *, +, {n}, {n,} or {n,m}: a group, an alternative, a lookaround or a back reference is not taken, so that checking a key takes time in proportion to its length';

const matchings: readonly (readonly [string, string, boolean])[] = [
  ['^github_pat_.+$', 'github_pat_11ABCDEFG', true],
  ['^github_pat_.+$', 'ghp_11ABCDEFG', false],
  ['^xoxb-[0-9]+-[A-Za-z0-9]{4}$', 'xoxb-1234-aB9z', true],
  ['^xoxb-[0-9]+-[A-Za-z0-9]{4}$', 'xoxb-1234-aB9', false],
  ['^a*ab$', 'aaab', true],
  ['^\\d{2,3}\\w?$', '123_', true],
  ['^\\d{2,3}\\w?$', '1', false],
  ['^\\d{2,}$', '1234567', true],
  ['^[^x\\d]+$', 'abc', true],
  ['^[^x\\d]+$', 'ab1', false],
  ['^[\\-a-c]+$', '-cab', true],
  ['^[a-]b$', '-b', true],
  ['^\\.\\$\\\\\\/$', '.$\\/', true],
  ['^.$', '\n', false],
  ['^.$', '😀', true],
  ['^[😀-😃]$', '😁', true],
  ['^[😀-😃]$', '😄', false],
  ['^k?e*y+$', 'y', true],
  ['^k?e*y+$', 'kk', false],
  ['^$', '', true],
];

describe('the pattern a key matches', () => {
  it('matches a key as JavaScript matches it with the u flag', () => {
    expect(matchings.map(([pattern, key]) => matchesKeyPattern(pattern, key))).toEqual(
      matchings.map(([pattern, key]) => new RegExp(pattern, 'u').test(key)),
    );
    expect(matchings.map(([, , matched]) => matched)).toEqual(
      matchings.map(([pattern, key]) => new RegExp(pattern, 'u').test(key)),
    );
  });

  it('matches no key of more than 8,192 characters, so that a check never runs longer than one of that length', () => {
    expect([
      matchesKeyPattern('^a*$', 'a'.repeat(8192)),
      matchesKeyPattern('^a*$', 'a'.repeat(8193)),
      matchesKeyPattern(`^${'\\w*'.repeat(66)}$`, `${'a'.repeat(8191)}!`),
    ]).toEqual([true, false, false]);
  });

  it('is matched by no key where the pattern is not one the runtime takes', () => {
    expect([matchesKeyPattern('^(a)$', 'a'), matchesKeyPattern('a', 'a')]).toEqual([false, false]);
  });
});

describe('the pattern of a way of a key', () => {
  it('is taken from ^ to $, of characters and classes, each repeated', () => {
    expect(
      ['^trk_[A-Za-z0-9]{32}$', '^trk_\\w+-\\d{1,4}$', '^[^x]$', '^\\(trk\\)\\.$'].map((pattern) =>
        patternProblemsOf(pattern),
      ),
    ).toEqual([[], [], [], []]);
  });

  it('refuses a group, an alternative, a lookaround, a back reference, a lazy repeat and a pattern JavaScript refuses', () => {
    const refused = [
      'trk_\\w+',
      '^trk_\\w+',
      '^',
      '^(trk)_\\w+$',
      '^trk|tok$',
      '^(?=trk)\\w+$',
      '^(t)\\1$',
      '^trk_\\w+?$',
      '^trk_\\$',
      '^[z-a]$',
      '^[\\d-z]$',
      '^a{3,2}$',
      '^a{,2}$',
      '^[^]$',
      '^\\s+$',
      '^a^b$',
    ];

    expect(refused.map((pattern) => patternProblemsOf(pattern))).toEqual(
      refused.map(() => [['/credentials/0/pattern', keyPatternShape]]),
    );
  });
});

describe('the bounds of the pattern of a way of a key', () => {
  it('refuses more than 1,000 repetitions, and more than 200 characters', () => {
    expect([
      patternProblemsOf('^a{1001}$'),
      patternProblemsOf('^a{2,1001}$'),
      patternProblemsOf('^a{1000}$'),
      patternProblemsOf(`^${'a'.repeat(199)}$`),
    ]).toEqual([
      [['/credentials/0/pattern', 'Expected repetitions of at most 1,000']],
      [['/credentials/0/pattern', 'Expected repetitions of at most 1,000']],
      [],
      [['/credentials/0/pattern', 'Expected a pattern of at most 200 characters']],
    ]);
  });

  it('stands beside an example, which shows the person the format it holds a key to', () => {
    expect(problemsOf({ ...tracker, credentials: [{ ...aKey, pattern: '^trk_\\w+$' }] })).toEqual([
      [
        '/credentials/0/example',
        'Expected example beside pattern, which shows the person the format of the key the pattern holds a value to',
      ],
    ]);
  });
});
