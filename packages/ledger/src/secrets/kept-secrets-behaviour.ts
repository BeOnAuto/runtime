import type { SecretRows } from '@on.auto/secrets';
import { rowsBehaviour, storeBehaviour, type SecretsEntry } from '@on.auto/secrets/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { layoutIn } from '../layout/ledger-layout-behaviour.ts';
import { ledgerLayout } from '../layout/ledger-layout.ts';
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

function openedOnTheLedgersDatabase(entry: KeptSecretsEntry): void {
  it('are read on connections of their own, opened on the database the ledger made in its layout, which they leave in it', async () => {
    const database = await entry.aDatabase();
    await aLedger(entry, database);

    const rows = await Effect.runPromise(entry.secretRowsOn(database));
    onTestFinished(() => rows.close());

    expect(await Effect.runPromise(rows.read('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'))).toBeUndefined();
    expect((await layoutIn(entry, database)).layout).toBe(ledgerLayout);
  });
}

export function keptSecretsBehaviour(entry: KeptSecretsEntry): void {
  describe('the secrets it keeps', () => {
    rowsBehaviour(secretsEntryOf(entry));
    storeBehaviour(secretsEntryOf(entry));
    openedOnTheLedgersDatabase(entry);
  });
}
