import { eventAppenderOf, eventCodecOf, statement } from '@on.auto/ledger';
import {
  RunLogRecordSchema,
  runLogRecordOf,
  type PositionedEvent,
  type RunLogEvent,
  type RunLogRecord,
  type RunLogStore,
} from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { runForgotten } from '../listeners/listener-rows.ts';
import { runLogStreamOf } from './run-address.ts';
import { lineageOfRecord } from './run-lineage.ts';
import { latestSnapshotOf, savedSnapshot } from './snapshot-chunks.ts';

const codec = eventCodecOf(RunLogRecordSchema);

function endsTheRun(event: RunLogEvent): boolean {
  return event.outputs.some(({ kind }) => kind === 'settle');
}

function positioned(after: number, events: readonly RunLogEvent[]): readonly PositionedEvent[] {
  return events.map((event, index) => ({ version: after + index + 1, event }));
}

function knownRun(database: HostDatabase, runKey: string): Effect.Effect<void> {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_runs (run_key, stream_id) VALUES (${runKey}, ${runLogStreamOf(runKey)})
        ON CONFLICT (run_key) DO NOTHING`,
    ),
  );
}

function endedAt(database: HostDatabase, runKey: string, version: number): Effect.Effect<void> {
  return Effect.orDie(
    database.write(statement`UPDATE workflow_runs SET ended_at = ${version} WHERE run_key = ${runKey}`),
  ).pipe(Effect.andThen(runForgotten(database, runKey)));
}

export function ledgerRunLogStore(database: HostDatabase): RunLogStore {
  const append = eventAppenderOf(database.store, RunLogRecordSchema);
  const streamAfter = (runKey: string, version: number) =>
    Effect.promise(() => database.store.read(runLogStreamOf(runKey), version));
  const eventsAfter = (runKey: string, version: number): Effect.Effect<readonly PositionedEvent[]> =>
    streamAfter(runKey, version).pipe(
      Effect.flatMap(({ messages }) => Effect.forEach(messages, codec.decode)),
      Effect.map((records: readonly RunLogRecord[]) =>
        positioned(
          version,
          records.map(({ data }) => data),
        ),
      ),
    );
  return {
    load: (runKey) =>
      Effect.gen(function* () {
        const snapshot = yield* latestSnapshotOf(database, runKey);
        const tail = yield* eventsAfter(runKey, snapshot?.snapshot.version ?? 0);
        return { snapshot, tail };
      }),
    append: (runKey, event, { expectedVersion, context }, lineage) =>
      Effect.gen(function* () {
        if (expectedVersion === 0) {
          yield* knownRun(database, runKey);
        }
        yield* append(runLogStreamOf(runKey), [runLogRecordOf(event)], {
          expectedVersion,
          context,
          lineage: yield* lineageOfRecord(database, runKey, lineage),
        });
        if (endsTheRun(event)) {
          yield* endedAt(database, runKey, expectedVersion + 1);
        }
      }),
    eventsAfter,
    saveSnapshot: (snapshot) =>
      Effect.flatMap(streamAfter(snapshot.runId, snapshot.version - 1), ({ messages, version }) =>
        messages.length > 0
          ? savedSnapshot(database, snapshot)
          : Effect.die(
              new RangeError(`A snapshot at version ${snapshot.version} of a run whose log holds ${version} events`),
            ),
      ),
  };
}
