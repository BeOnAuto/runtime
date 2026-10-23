import { statement } from '@on.auto/ledger';
import type { RecordedEvent } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { runGateOf } from './run-gate.ts';

const playbookKey = 'playbook/acme/alpha/';

const stream = `${playbookKey}run-logs/r-1`;

const PassedRow = Schema.Struct({ listener: Schema.String, passed: WholeNumber });

const PassedRunRow = Schema.Struct({ run_key: Schema.String, passed_through: WholeNumber });

function passedRuns(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(PassedRunRow, database.read(statement`SELECT run_key, passed_through FROM workflow_passed_runs`)),
  );
}

function listenersOf(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners ORDER BY listener`)),
  );
}

function beforePassing(database: HostDatabase, between: Effect.Effect<unknown>): HostDatabase {
  const done = { once: false };
  return {
    ...database,
    write: (written) =>
      Effect.suspend(() => {
        const passing = !done.once && written.strings.join('').includes('INSERT INTO workflow_passed_runs');
        done.once ||= passing;
        return passing ? Effect.andThen(between, database.write(written)) : database.write(written);
      }),
  };
}

function armingWhilePassing(database: HostDatabase): HostDatabase {
  return beforePassing(
    database,
    Effect.promise(() => armedAt(database, 'between', 2)),
  );
}

function runRecord(version: number): RecordedEvent {
  return {
    id: `record-${version}`,
    cursor: `cursor-${version}`,
    causationId: null,
    correlationId: null,
    stream,
    version,
    globalPosition: version,
    type: 'input_applied',
    data: null,
    context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
}

function dispatchedThrough(database: HostDatabase, through: number) {
  return Effect.runPromise(
    database.write(
      statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through) VALUES (${'acme/alpha/r-1'}, ${stream}, ${through})
        ON CONFLICT (run_key) DO UPDATE SET dispatched_through = excluded.dispatched_through`,
    ),
  );
}

function armedAt(database: HostDatabase, listener: string, armedBy: number) {
  return Effect.runPromise(
    insertedListener(database, {
      runKey: 'acme/alpha/r-1',
      listener,
      playbookKey,
      streamId: stream,
      armedBy,
      filters: '[]',
      workflow: 'wait',
      version: 1,
      passed: false,
    }),
  );
}

describe('the gate the records of a run pass through to the follower', () => {
  it('holds a record until its outputs are dispatched, and passes the listeners it armed when it passes it', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(database, playbookKey);
    await dispatchedThrough(database, 0);
    const held = await Effect.runPromise(gate.verdictOn(runRecord(1), false));
    await dispatchedThrough(database, 2);
    await armedAt(database, 'first', 1);
    await armedAt(database, 'second', 3);

    const verdicts = await Effect.runPromise(
      Effect.forEach([1, 2, 3], (version) => gate.verdictOn(runRecord(version), false)),
    );
    const listeners = await Effect.runPromise(
      rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners ORDER BY listener`)),
    );

    expect([held, verdicts]).toEqual(['held', ['listened', 'passed', 'held']]);
    expect(listeners).toEqual([
      { listener: 'first', passed: 1 },
      { listener: 'second', passed: 0 },
    ]);
  });

  it('passes a record held too long, and the listeners it armed, even those kept after it passed', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(database, playbookKey);
    await dispatchedThrough(database, 0);
    await armedAt(database, 'before', 2);

    const verdict = await Effect.runPromise(gate.verdictOn(runRecord(2), true));
    await armedAt(database, 'after', 2);
    await armedAt(database, 'later', 3);
    const listeners = await Effect.runPromise(
      rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners ORDER BY listener`)),
    );

    expect(verdict).toBe('overdue');
    expect(listeners).toEqual([
      { listener: 'after', passed: 1 },
      { listener: 'before', passed: 1 },
      { listener: 'later', passed: 0 },
    ]);
  });
});

describe('the gate passing a record of a run held too long', () => {
  it('passes a listener the dispatch keeps after the gate read the listeners and before it marked the run passed', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(armingWhilePassing(database), playbookKey);
    await dispatchedThrough(database, 0);

    const verdict = await Effect.runPromise(gate.verdictOn(runRecord(2), true));

    expect(verdict).toBe('overdue');
    expect(await listenersOf(database)).toEqual([{ listener: 'between', passed: 1 }]);
  });

  it('forgets how far it passed a run once the dispatch of the run reaches that far', async () => {
    const database = await openedOn(await onSQLite());
    const gate = runGateOf(database, playbookKey);
    const watermark = sqlWatermark(database);
    await dispatchedThrough(database, 0);
    await Effect.runPromise(gate.verdictOn(runRecord(2), true));
    const kept = await passedRuns(database);

    await Effect.runPromise(watermark.advance('acme/alpha/r-1', 1));
    const behind = await passedRuns(database);
    await Effect.runPromise(watermark.advance('acme/alpha/r-1', 2));

    expect([kept, behind]).toEqual([
      [{ run_key: 'acme/alpha/r-1', passed_through: 2 }],
      [{ run_key: 'acme/alpha/r-1', passed_through: 2 }],
    ]);
    expect(await passedRuns(database)).toEqual([]);
  });
});

describe('the gate noting how far it passed a run', () => {
  it('notes nothing of a run whose dispatch reached the record, or that ended, after the gate read its watermark', async () => {
    const reached = await openedOn(await onSQLite());
    const ended = await openedOn(await onSQLite());
    const caughtUp = sqlWatermark(reached).advance('acme/alpha/r-1', 2);
    const finished = ended.write(
      statement`UPDATE workflow_runs SET ended_at = ${2} WHERE run_key = ${'acme/alpha/r-1'}`,
    );
    await dispatchedThrough(reached, 0);
    await dispatchedThrough(ended, 0);

    const verdicts = await Effect.runPromise(
      Effect.all([
        runGateOf(beforePassing(reached, caughtUp), playbookKey).verdictOn(runRecord(2), true),
        runGateOf(beforePassing(ended, Effect.orDie(finished)), playbookKey).verdictOn(runRecord(2), true),
      ]),
    );

    expect(verdicts).toEqual(['overdue', 'overdue']);
    expect([await passedRuns(reached), await passedRuns(ended)]).toEqual([[], []]);
  });
});
