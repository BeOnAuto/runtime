import { stripVTControlCharacters } from 'node:util';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfAnotherVersion } from '../database/ledger-of-another-version.ts';
import { startupFailureNoticeIn } from './failure-notice.ts';

const secretsOfAnOlderShape = {
  table: 'kept_secrets',
  holds: 'secrets',
  found: ['held', 'id', 'kept_at', 'kept_by', 'version'],
  kept: ['claimed_until', 'ends_with', 'held', 'id', 'kept_at', 'kept_by', 'kid', 'version', 'wrapped_key'],
};

const ledgerFileOfAnotherVersion = ledgerOfAnotherVersion(secretsOfAnOlderShape, {
  store: 'sqlite',
  file: '/Users/ada/.auto-runtime/ledger.db',
});

const servicesFailed = new Error("The server's services could not start", { cause: ledgerFileOfAnotherVersion });

describe('the notice that a server could not start on a ledger file of another version', () => {
  it('says where the ledger is and why it is refused, what to do with the command that does it, where to ask, and the columns last', () => {
    expect(startupFailureNoticeIn(1)(servicesFailed)?.split('\n')).toEqual([
      '  ✖ Auto Runtime could not start',
      '',
      '  The ledger at /Users/ada/.auto-runtime/ledger.db was made by another',
      '  version of Auto Runtime. This version keeps secrets in a different shape,',
      '  and it does not yet carry a ledger over from one version to the next.',
      '',
      '  What you can do',
      '    Delete the ledger and start Auto Runtime again. Every playbook,',
      '    definition and run it holds goes with it, so if it holds work you want',
      '    to keep, ask us before you delete it.',
      '',
      '      rm -f /Users/ada/.auto-runtime/ledger.db{,-wal,-shm}',
      '',
      '  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
      '',
      '  kept_secrets has the columns held, id, kept_at, kept_by, version, where',
      '  this version keeps claimed_until, ends_with, held, id, kept_at, kept_by,',
      '  kid, version, wrapped_key.',
    ]);
  });

  it('marks the failure in red, sets the command apart in cyan, links Discord and dims the columns where there are colors', () => {
    const notice = String(startupFailureNoticeIn(24)(ledgerFileOfAnotherVersion));

    expect(notice).toContain('\u001B[31m✖\u001B[39m');
    expect(notice).toContain('\u001B[36mrm -f /Users/ada/.auto-runtime/ledger.db{,-wal,-shm}\u001B[39m');
    expect(notice).toContain('\u001B]8;;https://discord.gg/B8BKcKMRm8\u001B\\');
    expect(notice).toContain('\u001B[2m  kid, version, wrapped_key.\u001B[22m');
    expect(stripVTControlCharacters(notice)).toBe(startupFailureNoticeIn(1)(servicesFailed));
  });

  it('leaves any other failure to the line that names it', () => {
    expect([
      startupFailureNoticeIn(24)(new Error('listen EADDRINUSE: address already in use :::5555')),
      startupFailureNoticeIn(24)('a failure that is no error'),
    ]).toEqual([undefined, undefined]);
  });
});

describe('the notice that a server could not start on a ledger in PostgreSQL of another version', () => {
  it('says to point DATABASE_URL at an empty database, with no command', () => {
    const inPostgreSQL = ledgerOfAnotherVersion(secretsOfAnOlderShape, {
      store: 'postgresql',
      url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
      host: 'db.example.com:5432',
      database: 'auto_runtime',
      credentials: { kind: 'url' },
    });

    expect(startupFailureNoticeIn(1)(inPostgreSQL)?.split('\n').slice(2, 15)).toEqual([
      '  The ledger in the PostgreSQL database auto_runtime on db.example.com:5432',
      '  was made by another version of Auto Runtime. This version keeps secrets in',
      '  a different shape, and it does not yet carry a ledger over from one',
      '  version to the next.',
      '',
      '  What you can do',
      '    Point DATABASE_URL at an empty database, or empty this one, and start',
      '    Auto Runtime again. The ledger then starts with no playbooks,',
      '    definitions or runs, so if this one holds work you want to keep, ask us',
      '    before you do.',
      '',
      '  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
      '',
    ]);
  });
});
