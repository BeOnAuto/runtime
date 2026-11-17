import { statement, VersionConflict } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { ledgerRunLogStore } from './ledger-run-store.ts';
import { runKeyOf, runLogStreamOf } from './run-address.ts';
import { runLogContextOf } from './run-log-context.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

const largeInput = { text: 'é'.repeat(700_000) };

function ledgerOn(fileName: string): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

function onlyOf<A>(items: readonly A[]): A {
  const [only] = items;
  if (only === undefined || items.length > 1) {
    throw new Error(`Expected one, and there were ${items.length}`);
  }
  return only;
}

const at = '2026-10-01T09:00:00.000Z';

const attributes = {
  org: 'acme',
  playbook: 'alpha',
  run_id: 'r-1',
  definition: { name: 'close', version: 2 },
  caller: { id: 'acme-admin', org: 'acme', permissions: [], playbooks: '*' },
  depth: 0,
  call_depth: 0,
};

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

describe('the run store of the host, recording the end of a run', () => {
  it('records nothing of the end when the append that ends the run meets a conflict, since both are one transaction', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(workflow('do:\n  - done: { set: { done: true } }'))));
    const database = await openedOn({ store: 'sqlite', file });
    const store = ledgerRunLogStore(database);
    const ends = () => Effect.runPromise(database.read(statement`SELECT ended_at, ended_time FROM workflow_runs`));
    const ending = onlyOf(await Effect.runPromise(store.eventsAfter(runKeyOf(run), 0)));
    const logged = onlyOf((await database.store.read(runLogStreamOf(runKeyOf(run)))).messages);
    const recorded = await ends();
    await Effect.runPromise(database.write(statement`UPDATE workflow_runs SET ended_at = NULL, ended_time = NULL`));

    const appendedAgain = await Effect.runPromise(
      Effect.result(
        store.append(
          runKeyOf(run),
          ending.event,
          { expectedVersion: 0, context: logged.context },
          { cause: { kind: 'none' }, attributes: {} },
        ),
      ),
    );

    expect(recorded).toEqual([{ ended_at: 1, ended_time: ending.event.receipt.at }]);
    expect([appendedAgain, await ends()]).toEqual([
      Result.fail(new VersionConflict()),
      [{ ended_at: null, ended_time: null }],
    ]);
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

describe('the context of the records of a workflow run', () => {
  it('names the run, its workflow and version, and the caller it acts as, with no chain at the top', () => {
    expect(runLogContextOf(attributes, at)).toEqual({
      at,
      by: 'acme-admin',
      runId: 'r-1',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 2,
    });
  });

  it('carries the call that started the run, its depths, the trigger that started it and the person it acts for', () => {
    const chained = {
      ...attributes,
      depth: 2,
      call_depth: 1,
      called_by: { run_id: 'r-0', reference: '/do/0/check', run: 1 },
      trigger: { kind: 'event', reference: '/schedule/on' },
      acts_for: 'person:ada',
    };

    expect(runLogContextOf(chained, at)).toMatchObject({
      calledBy: { runId: 'r-0', reference: '/do/0/check', run: 1 },
      callDepth: 1,
      depth: 2,
      trigger: { kind: 'event', reference: '/schedule/on' },
      actsFor: 'person:ada',
    });
  });

  it('fails as a defect on attributes it cannot read, which the host never writes', () => {
    expect(() => runLogContextOf({ definition: 'close' }, at)).toThrow('run_id');
  });
});
