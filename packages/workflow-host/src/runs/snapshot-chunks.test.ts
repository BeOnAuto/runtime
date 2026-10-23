import { statement } from '@on.auto/ledger';
import { snapshotOf } from '@on.auto/workflow-engine';
import { Cause, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { ledgerRunLogStore } from './ledger-run-store.ts';
import { runKeyOf } from './run-address.ts';

const run = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

const detailOf = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.String }));

function defectOf<A, E>(work: Effect.Effect<A, E>): Promise<unknown> {
  return Effect.runPromise(Effect.flip(Effect.sandbox(work))).then((cause) => Cause.squash(cause));
}

describe('the run store of the host, refusing', () => {
  it('refuses to load a run whose snapshot does not decode', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));
    const database = await openedOn({ store: 'sqlite', file });
    await Effect.runPromise(
      database.write(
        statement`INSERT INTO workflow_snapshot_chunks (run_key, version, chunk, chunks, bytes, text)
          VALUES (${runKeyOf(run)}, ${1}, ${0}, ${1}, ${2}, ${'{}'})`,
      ),
    );

    const defect = await defectOf(ledgerRunLogStore(database).load(runKeyOf(run)));

    expect(detailOf(defect).detail).toContain('A snapshot of the run does not decode');
  });

  it('refuses a snapshot of an event its log does not hold yet', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));
    const state = await Effect.runPromise(hosted.host.stateOf(run));
    const runStore = ledgerRunLogStore(await openedOn({ store: 'sqlite', file }));

    const defect = await defectOf(runStore.saveSnapshot(snapshotOf(state, 2)));

    expect(defect).toEqual(new RangeError('A snapshot at version 2 of a run whose log holds 1 events'));
  });
});
