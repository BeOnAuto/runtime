import { describe, expect, it } from 'vitest';

import { matchesKeyPattern } from '../index.ts';
import { keyProblemsOf, problemsOf, refusedAt } from '../testing/entry-problems.ts';
import { drive, ledgers, tracker } from '../testing/fixture-providers.ts';

const [aKey] = tracker.credentials;

function marked(marks: Readonly<Record<string, readonly string[]>>): readonly string[] {
  return problemsOf({ ...tracker, marks, credentials: [{ ...aKey, test: { tool: 'viewer' } }] }).map(([path]) => path);
}

describe('how a way of a key says its key is made', () => {
  it('is required of every way of a key, in instructions and key_page', () => {
    const { instructions: _instructions, key_page: _keyPage, ...unexplained } = { ...aKey };

    expect(problemsOf({ ...tracker, credentials: [unexplained] })).toEqual([
      ['/credentials/0/instructions', 'Expected instructions, which a secret way takes'],
      ['/credentials/0/key_page', 'Expected key_page, which a secret way takes'],
    ]);
  });
});

describe('the instructions of a way of a key', () => {
  it('are Markdown of at most 1,000 characters, with no HTML', () => {
    expect([
      keyProblemsOf({ instructions: 'Make a key under **Settings**, [Keys](https://app.tracker.example.com/keys).' }),
      keyProblemsOf({ instructions: '' }),
      keyProblemsOf({ instructions: 'a'.repeat(1001) }),
      keyProblemsOf({ instructions: 'Make a key at <a href="https://evil.example.com">Settings</a>.' }),
      keyProblemsOf({ instructions: 'Make a key at <https://app.tracker.example.com/keys>.' }),
      keyProblemsOf({ instructions: 'A key holds 40 characters or more, as in 3 < 40.' }),
    ]).toEqual([
      [],
      [['/credentials/0/instructions', 'Expected a value with a length of at least 1']],
      [['/credentials/0/instructions', 'Expected a value with a length of at most 1000']],
      [
        [
          '/credentials/0/instructions',
          'Expected Markdown without HTML: write a link as [the page](https://…) and no tag',
        ],
      ],
      [
        [
          '/credentials/0/instructions',
          'Expected Markdown without HTML: write a link as [the page](https://…) and no tag',
        ],
      ],
      [],
    ]);
  });
});

describe('the key page of a way of a key', () => {
  it('is the https page where the key is made, with no user name or password in it', () => {
    const notAKeyPage =
      'Expected the https address of the page where the key is made, written out from https://, with no user name or password in it';

    expect(
      [
        'https://app.tracker.example.com/settings/keys',
        'http://app.tracker.example.com/settings/keys',
        'https:app.tracker.example.com',
        'https://app.tracker.example.com@evil.example.com/keys',
        'https://user:secret@app.tracker.example.com/keys',
        'https://app tracker',
      ].map((page) => keyProblemsOf({ key_page: page })),
    ).toEqual([
      [],
      [['/credentials/0/key_page', notAKeyPage]],
      [['/credentials/0/key_page', notAKeyPage]],
      [['/credentials/0/key_page', notAKeyPage]],
      [['/credentials/0/key_page', notAKeyPage]],
      [['/credentials/0/key_page', notAKeyPage]],
    ]);
  });
});

describe('the example of a way of a key', () => {
  it('shows what a key looks like, with an ellipsis in place of its characters, so that it never reads as a key', () => {
    expect([
      keyProblemsOf({ example: 'trk_…' }),
      keyProblemsOf({ example: 'trk_4f9c2b1e8a7d6c5b4a3f2e1d' }),
      keyProblemsOf({ example: `trk_${'a'.repeat(96)}…` }),
    ]).toEqual([
      [],
      [
        [
          '/credentials/0/example',
          'Expected an ellipsis, …, in place of the characters of the key, as in ghp_…, so that an example never reads as a key',
        ],
      ],
      [['/credentials/0/example', 'Expected a value with a length of at most 100']],
    ]);
  });
});

describe('the fields that say how a key is made', () => {
  it('stand on a way of a key alone, but for the page where a way of consent’s own client is made', () => {
    const [consent] = drive.credentials;
    const keyHelp = { instructions: 'Sign in.', key_page: 'https://accounts.drive.example.com', example: 'drv_…' };
    const takenByConsent = 'an authorization way takes issuer, scope, says, parameters';

    expect(problemsOf({ ...drive, credentials: [{ ...consent, ...keyHelp }] }).map(([path]) => path)).toEqual([
      '/credentials/0/instructions',
      '/credentials/0/example',
    ]);
    expect(problemsOf({ ...drive, credentials: [{ ...consent, pattern: '^drv_.+$' }] })).toEqual([
      ['/credentials/0/pattern', expect.stringContaining(`Expected no pattern: ${takenByConsent}`)],
    ]);
    expect(
      problemsOf({ ...ledgers, credentials: [{ ...ledgers.credentials[0], instructions: 'Make a client.' }] }),
    ).toEqual([
      [
        '/credentials/0/instructions',
        'Expected no instructions: a client_credentials way takes issuer, scope, says, parameters, key_page, key_page_title, client_id_title, steps, limitation, placeholders, base_url, and path_values',
      ],
    ]);
  });
});

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

describe('the app credentials a way of a key takes', () => {
  const tokenOfTheApp = {
    name: 'app_level_token',
    description: 'Tracker app-level token',
    instructions: 'Make a token under **Settings**, **App tokens**.',
  };

  it('are each named once, labelled and explained, with an example beside a pattern, on a way of a key alone', () => {
    const [consent] = drive.credentials;

    expect([
      refusedAt({ app_credentials: [tokenOfTheApp, { ...tokenOfTheApp, name: 'signing_secret', example: 'ss_…' }] }),
      refusedAt({ app_credentials: [] }),
      refusedAt({ app_credentials: [tokenOfTheApp, tokenOfTheApp] }),
      refusedAt({ app_credentials: [{ ...tokenOfTheApp, name: 'App Token', description: '' }] }),
      refusedAt({ app_credentials: [{ ...tokenOfTheApp, pattern: '^xapp-.+$' }] }),
      refusedAt({ app_credentials: [{ ...tokenOfTheApp, key_page: 'http://app.tracker.example.com' }] }),
      problemsOf({ ...drive, credentials: [{ ...consent, app_credentials: [tokenOfTheApp] }] }).map(([path]) => path),
    ]).toEqual([
      [],
      ['/credentials/0/app_credentials'],
      ['/credentials/0/app_credentials/1/name'],
      ['/credentials/0/app_credentials/0/name', '/credentials/0/app_credentials/0/description'],
      ['/credentials/0/app_credentials/0/example'],
      ['/credentials/0/app_credentials/0/key_page'],
      ['/credentials/0/app_credentials'],
    ]);
  });
});

describe('the test of a way of a key', () => {
  it('names one tool, as a server names its tools, on a way of a key alone', () => {
    const [consent] = drive.credentials;

    expect([
      refusedAt({ test: { tool: 'get_viewer' } }),
      refusedAt({ test: { tool: 'get viewer' } }),
      problemsOf({ ...drive, credentials: [{ ...consent, test: { tool: 'about_get' } }] }).map(([path]) => path),
    ]).toEqual([[], ['/credentials/0/test/tool'], ['/credentials/0/test']]);
  });

  it('calls a tool that needs no arguments and lists nothing it reaches, so it takes no with and no reached', () => {
    expect([
      refusedAt({ test: { tool: 'get_viewer', with: { team: 'acme' } } }),
      refusedAt({ test: { tool: 'get_viewer', reached: { list: '/teams', name: '/name' } } }),
    ]).toEqual([['/credentials/0/test/with'], ['/credentials/0/test/reached']]);
  });

  it('is refused where the entry marks the tool it names acts, since the runtime calls it with every key given', () => {
    expect([marked({ reads: ['viewer'] }), marked({ acts: ['issues.create'] }), marked({ acts: ['viewer'] })]).toEqual([
      [],
      [],
      ['/credentials/0/test/tool'],
    ]);
  });
});
