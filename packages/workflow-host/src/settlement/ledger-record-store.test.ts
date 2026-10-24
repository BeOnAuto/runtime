import type { SettleRun } from '@on.auto/definitions';
import type { Settlement } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runKey } from '../suite-testing/probe-subjects.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { ledgerRecordStore } from './ledger-record-store.ts';

const settledBy = { version: 2 };

const run = { runId: runKey, attributes: {} };

const succeeded: Settlement = { status: 'succeeded', output: 'done' };

const brokeDown: SettleRun = () => Effect.die(new Error('The ledger broke down'));

describe('the record store of the host, failing', () => {
  it('counts a settlement that broke down as an attempt, to be dispatched again', async () => {
    const recordStore = ledgerRecordStore(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), {
      settle: brokeDown,
      note: () => Effect.void,
      now: () => 0,
    });

    const failure = await Effect.runPromise(
      Effect.flip(recordStore.settle({ runId: runKey, settlement: { status: 'failed' } }, run, settledBy)),
    );

    expect(failure.detail).toContain('The ledger broke down');
  });

  it('fails a settlement or a due time it cannot record, to be dispatched again', async () => {
    const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const recordStore = ledgerRecordStore(database, { settle: brokeDown, note: () => Effect.void, now: () => 0 });
    database.failing(true);

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(recordStore.settle({ runId: runKey, settlement: succeeded }, run, settledBy)),
        Effect.flip(recordStore.noteDue({ runId: runKey, version: 1, nextDueAt: null }, run)),
      ]),
    );

    expect(failures).toEqual([
      expect.objectContaining({ output: 'settle', detail: 'The database was told to fail' }),
      expect.objectContaining({ output: 'note_due', detail: 'The database was told to fail' }),
    ]);
  });
});
