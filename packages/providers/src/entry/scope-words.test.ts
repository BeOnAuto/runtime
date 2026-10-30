import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider } from '../index.ts';
import { problemsOf } from '../testing/entry-problems.ts';
import { drive, ledgers, tracker } from '../testing/fixture-providers.ts';

const journalRead = 'Read the journal entries of the tenant.';

const ledgersIssuer = 'https://auth.ledgers.example.com/{tenant}';

function saying(says: unknown, scope = 'journal.read journal.write') {
  return problemsOf({ ...ledgers, credentials: [{ kind: 'client_credentials', issuer: ledgersIssuer, scope, says }] });
}

function unsaid(scope: string): string {
  return `Expected words for the scope ${scope}: one sentence of at most 120 characters that says what a connection can do through it`;
}

const aSentence = 'Expected one sentence that opens with a capital letter and ends with its one period';

describe('the words of the scopes of a way', () => {
  it('say each scope the way asks in one sentence, and no scope it does not ask', () => {
    const unsaying = { ...ledgers, credentials: [{ kind: 'client_credentials', issuer: ledgersIssuer, scope: 'a.b' }] };

    expect(saying({ 'journal.read': journalRead, 'journal.write': 'Post journal entries to the tenant.' })).toEqual([]);
    expect(saying({ 'journal.read': journalRead })).toEqual([['/credentials/0/says', unsaid('journal.write')]]);
    expect(saying({ 'journal.read': journalRead, 'ledger.close': 'Close the ledger.' }, 'journal.read')).toEqual([
      ['/credentials/0/says/ledger.close', 'Expected words only for a scope the way asks'],
    ]);
    expect(problemsOf(unsaying)).toEqual([['/credentials/0/says', unsaid('a.b')]]);
  });

  it('take at most 120 characters, open with a capital letter and end with their one period', () => {
    expect(saying({ 'journal.read': `R${'e'.repeat(118)}.` }, 'journal.read')).toEqual([]);
    expect(saying({ 'journal.read': `R${'e'.repeat(119)}.` }, 'journal.read')).toEqual([
      ['/credentials/0/says/journal.read', 'Expected a value with a length of at most 120'],
    ]);
    expect(
      [
        'read the journal entries.',
        'Read the journal entries',
        'Read the journal. Post to it.',
        'Read the journal entries of api.ledgers.example.com.',
      ].map((words) => saying({ 'journal.read': words }, 'journal.read')),
    ).toEqual([
      [['/credentials/0/says/journal.read', aSentence]],
      [['/credentials/0/says/journal.read', aSentence]],
      [['/credentials/0/says/journal.read', aSentence]],
      [],
    ]);
  });

  it('are none on a way that asks no scope, and none for a scope that is not one', () => {
    const consent = { kind: 'authorization', issuer: 'https://accounts.drive.example.com', scope: 'files.read  files' };

    expect(problemsOf({ ...tracker, credentials: [{ kind: 'none', says: { read: 'Read.' } }] })).toEqual([
      ['/credentials/0/says', 'Expected no says: a none way takes no other field but its description'],
      ['/credentials/0/says/read', 'Expected words only for a scope the way asks'],
    ]);
    expect(problemsOf({ ...drive, credentials: [{ ...consent, says: { 'files.read': 'Read the files.' } }] })).toEqual([
      ['/credentials/0/scope', 'Expected scopes separated by single spaces, such as files.read mail.send'],
    ]);
  });
});

describe('the addition of a way that says its scopes', () => {
  it('carries the words of the way, and none for a way that asks no scope', () => {
    const consented = Result.getOrThrow(additionOfProvider(drive, {}));
    const given = Result.getOrThrow(additionOfProvider(tracker, { placeholders: { site: 'acme' } }));

    expect(consented.says).toEqual({
      'files.read': 'Read the files of the account.',
      'files.write': 'Create and change the files of the account.',
    });
    expect(given).not.toHaveProperty('says');
  });
});
