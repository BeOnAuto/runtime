import { SQL } from '@event-driven-io/dumbo';
import { Conflict } from '@on.auto/operations';
import { runFacts, runIdsOfTheTests } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import { sqliteLedgerOpened } from '../connection/sqlite-opening.ts';
import { makeLedger } from '../ledger-service.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

const began = { type: 'run_began', data: { at: '2026-11-17T09:00:00.000Z', fn: 'brief' } } as const;

describe('a claim of a run id whose row the store does not show after its insert', () => {
  it('is met as the state changing while the command was decided, so the command is decided again and then refused', async () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    const { store } = sqliteLedgerOpened(
      { optionsOf: () => ({ driver: nodeSqliteEventStoreDriver, fileName }), inMemory: false },
      { runIds: runIdsOfTheTests },
    );
    onTestFinished(() => store.close());
    await store.migrate();
    await executedOn(fileName, (execute) =>
      execute.command(
        SQL`CREATE TRIGGER run_ids_unseen AFTER INSERT ON run_ids_1 BEGIN DELETE FROM run_ids_1 WHERE run_id = NEW.run_id; END`,
      ),
    );

    const refusal = await Effect.runPromise(
      Effect.flip(makeLedger(store).execute('definition/acme/d1/runs/r1', runFacts, [began])),
    );

    expect(refusal).toEqual(
      new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
    );
  });
});
