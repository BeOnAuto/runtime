import type { SecretRows } from '@on.auto/secrets';
import { rowsBehaviour, storeBehaviour, type SecretsEntry } from '@on.auto/secrets/testing';
import type { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { LedgerShapeRefused } from '../content/ledger-shape-refused.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

export interface KeptSecretsEntry extends LedgerEntry {
  readonly secretRowsOn: (database: string) => Effect.Effect<SecretRows>;
}

const rowsInOrder =
  'SELECT id, version, kept_at, claimed_until, ends_with, kept_by, held, wrapped_key, kid FROM kept_secrets ORDER BY id';

function secretsEntryOf(entry: KeptSecretsEntry): SecretsEntry {
  return {
    aDatabase: async () => {
      const database = await entry.aDatabase();
      await aLedger(entry, database);
      return database;
    },
    rowsOn: entry.secretRowsOn,
    rowsIn: (database) => entry.queried(database, rowsInOrder),
  };
}

function olderShapeBehaviour(entry: KeptSecretsEntry): void {
  it('refuses a database whose table of secrets has an older shape when the ledger opens, naming the columns found and kept, with words that say to delete it', async () => {
    const database = await entry.aDatabase();
    await entry.queried(
      database,
      'CREATE TABLE kept_secrets (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kept_at TEXT NOT NULL, kept_by TEXT NOT NULL, held TEXT NOT NULL)',
    );

    const refused = await aLedger(entry, database).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(LedgerShapeRefused);
    expect(refused).toMatchObject({
      table: 'kept_secrets',
      holds: 'secrets',
      found: ['held', 'id', 'kept_at', 'kept_by', 'version'],
      kept: ['claimed_until', 'ends_with', 'held', 'id', 'kept_at', 'kept_by', 'kid', 'version', 'wrapped_key'],
      message:
        "The ledger's database keeps secrets in a shape this server no longer reads: kept_secrets has the columns held, id, kept_at, kept_by, version, where this server keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Nothing stored before launch is carried over, so delete the local database and start the server again",
    });
  });
}

export function keptSecretsBehaviour(entry: KeptSecretsEntry): void {
  describe('the secrets it keeps', () => {
    rowsBehaviour(secretsEntryOf(entry));
    storeBehaviour(secretsEntryOf(entry));
    olderShapeBehaviour(entry);
  });
}
