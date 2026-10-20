import { LedgerShapeRefused } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Cause, Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { ledgerDatabaseOf, withARefusedShapeExplained } from './ledger-database.ts';
import { LedgerOfAnotherVersion } from './ledger-of-another-version.ts';

const somePools: unknown = expect.any(Function);

describe('the database of the ledger and the workflow host', () => {
  it('is the file of the ledger when the ledger is kept in SQLite', () => {
    expect(ledgerDatabaseOf(readSettings({ LEDGER_FILE: '/data/ledger.db' }))).toEqual({
      store: 'sqlite',
      file: '/data/ledger.db',
    });
  });

  it('is reached through the pools the server composes when the ledger is kept in PostgreSQL', () => {
    expect(
      ledgerDatabaseOf(
        readSettings({
          DATABASE_URL: 'postgresql://playbooks:secret@db.example.com/playbooks',
          SECRETS_KEY: secretsKey,
        }),
      ),
    ).toEqual({ store: 'postgresql', pools: somePools });
  });
});

const refusedShape = new LedgerShapeRefused({
  table: 'kept_secrets',
  holds: 'secrets',
  found: ['held', 'id', 'kept_at', 'kept_by', 'version'],
  kept: ['claimed_until', 'ends_with', 'held', 'id', 'kept_at', 'kept_by', 'kid', 'version', 'wrapped_key'],
  message: "The ledger's database keeps secrets in a shape this server no longer reads",
});

async function builtFrom(ledgerLayer: Layer.Layer<Ledger>): Promise<unknown> {
  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(ledgerLayer)));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : 'built';
}

describe('a ledger that refuses the shape of its database as it opens', () => {
  it('stops the start with words that say where the ledger is kept, from the settings', async () => {
    const refused = await builtFrom(
      withARefusedShapeExplained(
        Layer.effect(Ledger, Effect.die(refusedShape)),
        readSettings({ LEDGER_FILE: '/data/ledger.db' }),
      ),
    );

    expect(refused).toBeInstanceOf(LedgerOfAnotherVersion);
    expect(refused).toMatchObject({
      place: { store: 'sqlite', file: '/data/ledger.db' },
      table: 'kept_secrets',
      found: refusedShape.found,
      kept: refusedShape.kept,
    });
  });

  it('leaves any other failure of the ledger as it was', async () => {
    const unreachable = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    expect(
      await builtFrom(
        withARefusedShapeExplained(
          Layer.effect(Ledger, Effect.die(unreachable)),
          readSettings({ LEDGER_FILE: '/data/ledger.db' }),
        ),
      ),
    ).toBe(unreachable);
  });
});
