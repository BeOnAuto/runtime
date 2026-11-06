import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { drive, ledgers, tracker } from '../testing/fixture-providers.ts';

const [aKey] = tracker.credentials;

function keyProblemsOf(way: Readonly<Record<string, unknown>>) {
  return problemsOf({ ...tracker, credentials: [{ ...aKey, ...way }] });
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
  it('stand on a way of a key alone', () => {
    const [consent] = drive.credentials;
    const keyHelp = { instructions: 'Sign in.', key_page: 'https://accounts.drive.example.com', example: 'drv_…' };
    const takenByConsent = 'an authorization way takes issuer, scope, says, parameters';

    expect(problemsOf({ ...drive, credentials: [{ ...consent, ...keyHelp }] }).map(([path]) => path)).toEqual([
      '/credentials/0/instructions',
      '/credentials/0/key_page',
      '/credentials/0/example',
    ]);
    expect(problemsOf({ ...drive, credentials: [{ ...consent, pattern: '^drv_.+$' }] })).toEqual([
      ['/credentials/0/pattern', expect.stringContaining(`Expected no pattern: ${takenByConsent}`)],
    ]);
    expect(
      problemsOf({ ...ledgers, credentials: [{ ...ledgers.credentials[0], key_page: 'https://a.example' }] }),
    ).toEqual([
      ['/credentials/0/key_page', 'Expected no key_page: a client_credentials way takes issuer, scope, and says'],
    ]);
  });
});
