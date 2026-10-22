import { LedgerLayoutRefused } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Cause, Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { ledgerDatabaseOf, withARefusedLayoutExplained } from './ledger-database.ts';
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

const refusedLayout = new LedgerLayoutRefused({
  found: 2,
  kept: 1,
  message: "The ledger's database is in layout 2 of the ledger, where this server keeps layout 1",
});

async function builtFrom(ledgerLayer: Layer.Layer<Ledger>): Promise<unknown> {
  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(ledgerLayer)));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : 'built';
}

describe('a ledger that refuses the layout of its database as it opens', () => {
  it('stops the start with words that say where the ledger is kept, from the settings', async () => {
    const refused = await builtFrom(
      withARefusedLayoutExplained(
        Layer.effect(Ledger, Effect.die(refusedLayout)),
        readSettings({ LEDGER_FILE: '/data/ledger.db' }),
      ),
    );

    expect(refused).toBeInstanceOf(LedgerOfAnotherVersion);
    expect(refused).toMatchObject({
      found: 2,
      kept: 1,
      remedy: { command: 'rm -f /data/ledger.db /data/ledger.db-wal /data/ledger.db-shm' },
    });
  });

  it('says in the image which files to delete from the volume, from the distribution the settings name', async () => {
    const refused = await builtFrom(
      withARefusedLayoutExplained(
        Layer.effect(Ledger, Effect.die(refusedLayout)),
        readSettings({ LEDGER_FILE: '/app/data/ledger.db', RUNTIME_DISTRIBUTION: 'docker', DO_NOT_TRACK: '1' }),
      ),
    );

    expect(refused).toMatchObject({
      remedy: {
        says: "Delete ledger.db, ledger.db-wal and ledger.db-shm from the volume mounted at /data, the ledger's folder /app/data in the image, or remove the volume, and start Auto Runtime again. Everything in the ledger goes with it, every playbook, definition, run and connection among it.",
        command: undefined,
      },
    });
  });

  it('leaves any other failure of the ledger as it was', async () => {
    const unreachable = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    expect(
      await builtFrom(
        withARefusedLayoutExplained(
          Layer.effect(Ledger, Effect.die(unreachable)),
          readSettings({ LEDGER_FILE: '/data/ledger.db' }),
        ),
      ),
    ).toBe(unreachable);
  });
});
