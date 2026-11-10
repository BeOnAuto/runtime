import { statement } from '@on.auto/ledger';
import { Effect, Function, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { closeHostParts, openHostParts } from '../host/host-parts.ts';
import { systemClock } from '../loop/host-clock.ts';
import { startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const calling = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const CallSeen = Schema.Struct({
  run_key: Schema.String,
  state: Schema.String,
  call: Schema.NullOr(Schema.String),
  attributes: Schema.NullOr(Schema.String),
  result: Schema.NullOr(Schema.String),
});

const RunSeen = Schema.Struct({
  run_key: Schema.String,
  ended_at: Schema.NullOr(WholeNumber),
  ended_time: Schema.NullOr(WholeNumber),
  closed_at: Schema.NullOr(WholeNumber),
});

export type EndedCallRow = typeof CallSeen.Type;

export const keyOfTheRun = (runId: string): string => `acme/alpha/${runId}`;

export function callsIn(database: HostDatabase): Promise<readonly EndedCallRow[]> {
  return Effect.runPromise(
    rowsOf(
      CallSeen,
      database.read(statement`SELECT run_key, state, call, attributes, result FROM workflow_calls ORDER BY run_key`),
    ),
  );
}

export function runsIn(database: HostDatabase): Promise<readonly (typeof RunSeen.Type)[]> {
  return Effect.runPromise(
    rowsOf(
      RunSeen,
      database.read(statement`SELECT run_key, ended_at, ended_time, closed_at FROM workflow_runs ORDER BY run_key`),
    ),
  );
}

export function bytesOf({ call, attributes, result }: EndedCallRow): number {
  return [call, attributes, result]
    .filter((kept): kept is string => kept !== null)
    .reduce((bytes, kept) => bytes + Buffer.byteLength(kept), 0);
}

export async function ranOn(calls: readonly string[], paused: readonly string[] = []): Promise<HostDatabase> {
  const store = { database: await openedOn({ store: 'sqlite', file: aSQLiteFile() }) };
  const recorded = recordedOptionsOf();
  const parts = openHostParts(store, { ...recorded.options, clock: systemClock }, Function.constVoid);
  onTestFinished(() => closeHostParts(parts));
  const started = (runId: string, document: typeof calling) => {
    recorded.know(runId);
    return parts.submitted({ ...startOf(document), kind: 'started', runId: keyOfTheRun(runId), at: Date.now() });
  };
  await Effect.runPromise(
    Effect.andThen(
      Effect.forEach(calls, (runId) => started(runId, calling), { discard: true }),
      Effect.forEach(paused, (runId) => started(runId, pausing), { discard: true }),
    ),
  );
  await until(
    () => Promise.resolve(recorded.settleAttempts()),
    (attempts) => attempts >= calls.length,
  );
  await Effect.runPromise(parts.executor.idle());
  return store.database;
}

export function endOfTheLog(database: HostDatabase, runId: string): Promise<number> {
  return database.store.read(`playbook/acme/alpha/run-logs/${runId}`).then(({ version }) => version);
}

export function openingACallAfterItsRead(database: HostDatabase, runId: string): HostDatabase {
  const opened = database.write(
    statement`INSERT INTO workflow_calls (call_key, run_key, state) VALUES (${'late'}, ${keyOfTheRun(runId)}, 'running')
      ON CONFLICT (call_key) DO NOTHING`,
  );
  return { ...database, read: (asked) => Effect.tap(database.read(asked), () => opened) };
}
