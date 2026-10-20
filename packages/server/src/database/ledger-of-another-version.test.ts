import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfAnotherVersion, remedyFor } from './ledger-of-another-version.ts';

const secretsOfAnOlderShape = {
  table: 'kept_secrets',
  holds: 'secrets',
  found: ['held', 'id', 'kept_at', 'kept_by', 'version'],
  kept: ['claimed_until', 'ends_with', 'held', 'id', 'kept_at', 'kept_by', 'kid', 'version', 'wrapped_key'],
};

const inPostgreSQL = {
  store: 'postgresql',
  url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
  host: 'db.example.com:5432',
  database: 'auto_runtime',
  credentials: { kind: 'url' },
} as const;

describe('a ledger made by another version of Auto Runtime', () => {
  it('says in one message where the ledger is, why it is refused, what to do and where to ask, ending with the command that deletes it', () => {
    const refused = ledgerOfAnotherVersion(secretsOfAnOlderShape, {
      store: 'sqlite',
      file: '/Users/ada/.auto-runtime/ledger.db',
    });

    expect(refused.message).toBe(
      'The ledger at /Users/ada/.auto-runtime/ledger.db was made by another version of Auto Runtime. This version keeps secrets in a different shape, and it does not yet carry a ledger over from one version to the next. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Delete the ledger and start Auto Runtime again. Every playbook, definition and run it holds goes with it, so if it holds work you want to keep, ask us before you delete it. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8 To delete the ledger, run: rm -f /Users/ada/.auto-runtime/ledger.db{,-wal,-shm}',
    );
    expect(String(refused)).toMatch(/^LedgerOfAnotherVersion: The ledger at /u);
  });

  it('places a ledger file given as a relative path in the directory the server started in', () => {
    const refused = ledgerOfAnotherVersion(secretsOfAnOlderShape, { store: 'sqlite', file: 'data/ledger.db' });

    expect(refused.place).toEqual({ store: 'sqlite', file: join(process.cwd(), 'data', 'ledger.db') });
  });

  it('names the PostgreSQL database and its host, never the URL, and says to point DATABASE_URL at an empty one', () => {
    const refused = ledgerOfAnotherVersion(secretsOfAnOlderShape, inPostgreSQL);

    expect(refused.place).toEqual({ store: 'postgresql', database: 'auto_runtime', host: 'db.example.com:5432' });
    expect(refused.message).toBe(
      'The ledger in the PostgreSQL database auto_runtime on db.example.com:5432 was made by another version of Auto Runtime. This version keeps secrets in a different shape, and it does not yet carry a ledger over from one version to the next. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Point DATABASE_URL at an empty database, or empty this one, and start Auto Runtime again. The ledger then starts with no playbooks, definitions or runs, so if this one holds work you want to keep, ask us before you do. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
    );
    expect(refused.message).not.toContain('a-secret-password');
  });
});

describe('the remedy for a ledger file of another version', () => {
  it('quotes a path a shell would split, so the command deletes that file and the two beside it', () => {
    expect(remedyFor({ store: 'sqlite', file: "/Users/ada/Application Support/ada's runtime/ledger.db" }).command).toBe(
      String.raw`rm -f '/Users/ada/Application Support/ada'\''s runtime/ledger.db'{,-wal,-shm}`,
    );
  });
});
