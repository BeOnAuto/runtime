import { statement } from '@on.auto/ledger';
import { CallKeySchema, type CallKey } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface ListenerRow {
  readonly runKey: string;
  readonly listener: string;
  readonly playbookKey: string;
  readonly streamId: string;
  readonly armedBy: number;
  readonly filters: string;
  readonly workflow: string;
  readonly version: number;
  readonly passed: boolean;
}

export interface ListeningPlace {
  readonly playbookKey: string;
  readonly workflow: string;
  readonly version: number;
  readonly reference: string;
}

export interface ListenerPlace {
  readonly runKey: string;
  readonly listener: string;
}

const MatchedRow = Schema.Struct({
  run_key: Schema.String,
  listener: Schema.String,
  filters: Schema.String,
  workflow: Schema.String,
  version: WholeNumber,
});

const ListenerKeySchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.Int]));

const ListenerKeyRow = Schema.Struct({ listener: Schema.String });

export type MatchedListener = typeof MatchedRow.Type;

const ArmedRow = Schema.Struct({ armed_by: WholeNumber });

const CountRow = Schema.Struct({ listeners: WholeNumber });

export function listenerKeyOf(text: string): CallKey {
  const [runId, reference, run] = Schema.decodeUnknownSync(ListenerKeySchema)(text);
  return Schema.decodeUnknownSync(CallKeySchema)({ runId, reference, run });
}

function typesOf(filters: string): readonly string[] {
  const read = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String }))));
  return [...new Set(read(filters).map(({ type }) => type))];
}

export function insertedListener(database: HostDatabase, row: ListenerRow) {
  return Effect.gen(function* () {
    const { runKey, listener, playbookKey, streamId, armedBy, filters, workflow, version, passed } = row;
    yield* database.write(
      statement`INSERT INTO workflow_listeners (run_key, listener, playbook_key, stream_id, armed_by, filters, workflow, version, passed)
        VALUES (${runKey}, ${listener}, ${playbookKey}, ${streamId}, ${armedBy}, ${filters}, ${workflow}, ${version}, ${passed ? 1 : 0})
        ON CONFLICT (run_key, listener) DO NOTHING`,
    );
    yield* database.write(
      statement`UPDATE workflow_listeners SET passed = 1
        WHERE run_key = ${runKey} AND listener = ${listener} AND passed = 0 AND EXISTS (
          SELECT 1 FROM workflow_passed_runs
          WHERE workflow_passed_runs.run_key = workflow_listeners.run_key
            AND workflow_passed_runs.passed_through >= workflow_listeners.armed_by
        )`,
    );
    yield* Effect.forEach(
      typesOf(filters),
      (type) =>
        database.write(
          statement`INSERT INTO workflow_listener_types (playbook_key, type, run_key, listener)
            VALUES (${playbookKey}, ${type}, ${runKey}, ${listener}) ON CONFLICT DO NOTHING`,
        ),
      { discard: true },
    );
  });
}

export function removedListener(database: HostDatabase, { runKey, listener }: ListenerPlace) {
  return Effect.gen(function* () {
    yield* database.write(
      statement`DELETE FROM workflow_listener_types WHERE run_key = ${runKey} AND listener = ${listener}`,
    );
    const removed = yield* database.write(
      statement`DELETE FROM workflow_listeners WHERE run_key = ${runKey} AND listener = ${listener} RETURNING run_key`,
    );
    return removed.length > 0;
  });
}

export function isListening(database: HostDatabase, { runKey, listener }: ListenerPlace) {
  return Effect.map(
    database.read(
      statement`SELECT run_key FROM workflow_listeners WHERE run_key = ${runKey} AND listener = ${listener}`,
    ),
    (rows) => rows.length > 0,
  );
}

export function isListeningAt(database: HostDatabase, { playbookKey, workflow, version, reference }: ListeningPlace) {
  return Effect.map(
    rowsOf(
      ListenerKeyRow,
      database.read(
        statement`SELECT listener FROM workflow_listeners
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND version = ${version}`,
      ),
    ),
    (rows) => rows.some(({ listener }) => listenerKeyOf(listener).reference === reference),
  );
}

export function listenersInPlaybook(database: HostDatabase, playbookKey: string) {
  return Effect.map(
    rowsOf(
      CountRow,
      database.read(
        statement`SELECT count(*) AS listeners FROM workflow_listeners WHERE playbook_key = ${playbookKey}`,
      ),
    ),
    (rows) => rows.reduce((sum, { listeners }) => sum + listeners, 0),
  );
}

export function pendingArmings(database: HostDatabase, streamId: string): Effect.Effect<readonly number[]> {
  return Effect.map(
    Effect.orDie(
      rowsOf(
        ArmedRow,
        database.read(statement`SELECT armed_by FROM workflow_listeners WHERE stream_id = ${streamId} AND passed = 0`),
      ),
    ),
    (rows) => rows.map(({ armed_by: armedBy }) => armedBy),
  );
}

export function runPassedThrough(database: HostDatabase, runKey: string, version: number) {
  return Effect.asVoid(
    Effect.orDie(
      database
        .write(
          statement`INSERT INTO workflow_passed_runs (run_key, passed_through)
          SELECT ${runKey}, CAST(${version} AS BIGINT)
          WHERE NOT EXISTS (
            SELECT 1 FROM workflow_runs
            WHERE run_key = ${runKey} AND (ended_at IS NOT NULL OR dispatched_through >= ${version})
          )
          ON CONFLICT (run_key) DO UPDATE SET passed_through = excluded.passed_through`,
        )
        .pipe(
          Effect.andThen(
            database.write(
              statement`DELETE FROM workflow_passed_runs WHERE run_key = ${runKey} AND EXISTS (
              SELECT 1 FROM workflow_runs
              WHERE workflow_runs.run_key = workflow_passed_runs.run_key
                AND (workflow_runs.ended_at IS NOT NULL
                  OR workflow_runs.dispatched_through >= workflow_passed_runs.passed_through)
            )`,
            ),
          ),
        ),
    ),
  );
}

export function runCaughtUp(database: HostDatabase, runKey: string, through: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_passed_runs WHERE run_key = ${runKey} AND passed_through <= ${through}`,
      ),
    ),
  );
}

export function runForgotten(database: HostDatabase, runKey: string) {
  return Effect.asVoid(
    Effect.orDie(database.write(statement`DELETE FROM workflow_passed_runs WHERE run_key = ${runKey}`)),
  );
}

export function passedListeners(database: HostDatabase, streamId: string, version: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_listeners SET passed = 1
          WHERE stream_id = ${streamId} AND passed = 0 AND armed_by <= ${version}`,
      ),
    ),
  );
}

export interface ListenersAsked {
  readonly playbookKey: string;
  readonly type: string;
  readonly after: ListenerPlace;
  readonly limit: number;
}

export function listenersOfType(
  database: HostDatabase,
  { playbookKey, type, after, limit }: ListenersAsked,
): Effect.Effect<readonly MatchedListener[]> {
  return Effect.orDie(
    rowsOf(
      MatchedRow,
      database.read(
        statement`SELECT l.run_key, l.listener, l.filters, l.workflow, l.version
          FROM workflow_listener_types AS t
          JOIN workflow_listeners AS l ON l.run_key = t.run_key AND l.listener = t.listener
          WHERE t.playbook_key = ${playbookKey} AND t.type = ${type} AND l.passed = 1
            AND (t.run_key > ${after.runKey} OR (t.run_key = ${after.runKey} AND t.listener > ${after.listener}))
          ORDER BY t.run_key, t.listener
          LIMIT ${limit}`,
      ),
    ),
  );
}

const ArmedByRow = Schema.Struct({ armed_by: WholeNumber });

export function armedByOfListener(
  database: HostDatabase,
  runKey: string,
  listener: string,
): Effect.Effect<number | null, DatabaseFailed> {
  return rowsOf(
    ArmedByRow,
    database.read(
      statement`SELECT armed_by FROM workflow_listeners WHERE run_key = ${runKey} AND listener = ${listener}`,
    ),
  ).pipe(Effect.map((rows) => rows[0]?.armed_by ?? null));
}
