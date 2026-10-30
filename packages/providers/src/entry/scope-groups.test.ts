import { describe, expect, it } from 'vitest';

import { scopeWith } from '../index.ts';
import { problemsOf } from '../testing/entry-problems.ts';
import { drive, ledgers } from '../testing/fixture-providers.ts';

const [consent] = drive.credentials;

const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

const deleting = {
  name: 'delete',
  for: 'Delete files you no longer need.',
  scope: 'files.delete',
  says: { 'files.delete': 'Delete the files of the account.' },
};

function growingBy(more: unknown) {
  return problemsOf({ ...drive, credentials: [{ ...consent, more }] });
}

describe('the groups of scopes a way of consent may add', () => {
  it('each name what it is for and the scopes it adds with their words', () => {
    expect(growingBy([sharing, deleting])).toEqual([]);
  });

  it('refuse a name another group has, or one of another form, and a group that says what it is for in other than one sentence', () => {
    expect(growingBy([sharing, { ...deleting, name: 'share' }])).toEqual([
      ['/credentials/0/more/1/name', 'Expected a name no earlier group of more has'],
    ]);
    expect(
      growingBy([
        { ...sharing, name: 'Share files' },
        { ...deleting, for: 'delete files' },
      ]),
    ).toEqual([
      [
        '/credentials/0/more/0/name',
        'Expected 1 to 32 lowercase letters, digits and underscores, starting with a letter',
      ],
      [
        '/credentials/0/more/1/for',
        'Expected one sentence that opens with a capital letter and ends with its one period',
      ],
    ]);
  });

  it('refuse a scope the way or an earlier group asks already, one the group names twice, and scopes not separated by single spaces', () => {
    const askedTwice = { ...deleting, scope: 'files.delete files.share files.read' };

    expect(growingBy([sharing, { ...askedTwice, says: { ...askedTwice.says, ...sharing.says } }])).toEqual([
      ['/credentials/0/more/1/scope', 'Expected no files.share, which scope or an earlier group of more asks already'],
      ['/credentials/0/more/1/scope', 'Expected no files.read, which scope or an earlier group of more asks already'],
      ['/credentials/0/more/1/says', expect.stringContaining('Expected words for the scope files.read')],
    ]);
    expect(growingBy([{ ...sharing, scope: 'files.share files.share' }])).toEqual([
      ['/credentials/0/more/0/scope', 'Expected files.share once in the scope of the group'],
    ]);
    expect(growingBy([{ ...sharing, scope: 'files.share  files.read' }])).toEqual([
      ['/credentials/0/more/0/scope', 'Expected scopes separated by single spaces, such as files.read mail.send'],
    ]);
  });
});

describe('the words of the groups of scopes a way of consent may add', () => {
  it('say each scope a group adds, and no scope it does not add', () => {
    expect(growingBy([{ ...sharing, says: { 'files.delete': 'Delete the files of the account.' } }])).toEqual([
      [
        '/credentials/0/more/0/says',
        'Expected words for the scope files.share: one sentence of at most 120 characters that says what a connection can do through it',
      ],
      ['/credentials/0/more/0/says/files.delete', 'Expected words only for a scope the group adds'],
    ]);
  });

  it('are at least one, and only of a way of consent that asks a scope', () => {
    const credentialsWithMore = { ...ledgers.credentials[0], more: [sharing] };
    const scopeless = { kind: 'authorization', issuer: 'https://accounts.drive.example.com', more: [sharing] };

    expect(growingBy([])).toEqual([['/credentials/0/more', 'Expected a value with a length of at least 1']]);
    expect(problemsOf({ ...ledgers, credentials: [credentialsWithMore] })).toEqual([
      ['/credentials/0/more', 'Expected no more: a client_credentials way takes issuer, scope, and says'],
    ]);
    expect(problemsOf({ ...drive, credentials: [scopeless] })).toEqual([
      ['/credentials/0/more', 'Expected more only on a way that asks a scope, to which each group adds its own'],
    ]);
  });
});

describe('the scope a consent that asks more asks', () => {
  it('is the scopes of the one with those the group adds, each once and in their order', () => {
    expect([
      scopeWith('files.read files.write', 'files.share files.read'),
      scopeWith(undefined, 'files.share'),
    ]).toEqual(['files.read files.write files.share', 'files.share']);
  });
});
