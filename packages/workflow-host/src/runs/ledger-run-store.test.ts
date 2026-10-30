import { statement } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { ledgerRunLogStore } from './ledger-run-store.ts';
import { runKeyOf } from './run-address.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

const largeInput = { text: 'é'.repeat(700_000) };

function ledgerOn(fileName: string): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

describe('the run store of the host, ending a run', () => {
  it('forgets how far the follower passed the log of the run ahead of its dispatch', async () => {
    const file = aSQLiteFile();
    const database = await openedOn({ store: 'sqlite', file });
    await Effect.runPromise(
      database.write(
        statement`INSERT INTO workflow_passed_runs (run_key, passed_through) VALUES (${runKeyOf(run)}, ${1000})`,
      ),
    );
    const hosted = await hostedOn({ store: 'sqlite', file });

    await Effect.runPromise(hosted.host.start(run, startOf(workflow('do:\n  - done: { set: { done: true } }'))));
    const left = await Effect.runPromise(database.read(statement`SELECT run_key FROM workflow_passed_runs`));

    expect([(await Effect.runPromise(hosted.host.stateOf(run))).status, left]).toEqual(['ended', []]);
  });
});

describe('the run store of the host, keeping a run', () => {
  it('keeps the log of a run on the ledger, under the playbook, where the history of the run reads it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));
    const ledger = await ledgerOn(file);

    const history = await Effect.runPromise(
      ledger.readRecorded({ org: 'acme', playbook: 'alpha' }, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
    );

    expect(history.records.map(({ stream, type }) => [stream, type])).toEqual([
      [`playbook/acme/alpha/run-logs/${runId}`, 'input_applied'],
    ]);
  });

  it('keeps a snapshot larger than a chunk in chunks outside the ledger, and loads the run from it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(waiting, largeInput)));
    const database = await openedOn({ store: 'sqlite', file });
    const chunks = await Effect.runPromise(
      database.read(statement`SELECT version, chunk, chunks FROM workflow_snapshot_chunks ORDER BY chunk`),
    );
    const messages = await Effect.runPromise(database.read(statement`SELECT COUNT(*) AS messages FROM emt_messages`));

    const stored = await Effect.runPromise(ledgerRunLogStore(database).load(runKeyOf(run)));

    expect(chunks).toEqual([
      { version: 1, chunk: 0, chunks: 2 },
      { version: 1, chunk: 1, chunks: 2 },
    ]);
    expect(messages).toEqual([{ messages: 1 }]);
    expect(stored.tail).toEqual([]);
    expect(stored.snapshot?.bytes).toBeGreaterThan(1_400_000);
    expect(await Effect.runPromise(hosted.host.stateOf(run))).toEqual(
      expect.objectContaining({ status: 'running', inputs: 1 }),
    );
  });
});
