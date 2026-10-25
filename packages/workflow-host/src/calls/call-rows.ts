import { statement } from '@on.auto/ledger';
import { CallResultSchema, type CallResult } from '@on.auto/operations';
import { CallKeySchema, type OutputOrigin, type RunContext, type StartCall } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

const StartCallSchema = Schema.Struct({
  kind: Schema.Literal('start_call'),
  key: CallKeySchema,
  function: Schema.NonEmptyString,
  arguments: Schema.Json,
  longestMs: Schema.Int,
});

const CallText = Schema.fromJsonString(Schema.toCodecJson(StartCallSchema));

const AttributesText = Schema.fromJsonString(Schema.JsonObject);

const ResultText = Schema.fromJsonString(Schema.toCodecJson(CallResultSchema));

const encodeCall = Schema.encodeSync(CallText);

const encodeAttributes = Schema.encodeSync(AttributesText);

const encodeResult = Schema.encodeSync(ResultText);

const CallRowSchema = Schema.Struct({
  state: Schema.Literals(['running', 'waiting', 'answered', 'cancelled']),
  result: Schema.NullOr(ResultText),
  child: Schema.NullOr(Schema.String),
});

const StartedCallRow = Schema.Struct({
  call_key: Schema.String,
  run_key: Schema.String,
  call: CallText,
  attributes: AttributesText,
  started_by: WholeNumber,
});

const UnfinishedRow = Schema.Struct({ ...StartedCallRow.fields, result: Schema.NullOr(ResultText) });

const DueCallRow = Schema.Struct({ ...StartedCallRow.fields, child: Schema.String, resumes_after_ms: WholeNumber });

const SoonestRow = Schema.Struct({ soonest: Schema.NullOr(WholeNumber) });

const StartedByRow = Schema.Struct({ started_by: Schema.NullOr(WholeNumber) });

const WaitingRow = Schema.Struct({ call_key: Schema.String, call: CallText, child: Schema.String });

const CountRow = Schema.Struct({ open: WholeNumber });

export type CallRow = typeof CallRowSchema.Type;

interface CallOfARun {
  readonly key: string;
  readonly call: StartCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
}

export interface WaitingCallOfARun extends CallOfARun {
  readonly child: string;
  readonly resumesAfterMs: number;
}

export interface UnfinishedCall extends CallOfARun {
  readonly result: CallResult | null;
}

export interface WaitingCall {
  readonly key: string;
  readonly call: StartCall;
  readonly child: string;
}

export interface StartedCall {
  readonly call: StartCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
  readonly child: string | null;
  readonly root: string;
}

export function startedRow(
  database: HostDatabase,
  key: string,
  { call, run, origin, child, root }: StartedCall,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`INSERT INTO workflow_calls (call_key, run_key, state, call, attributes, child, root_id, started_by)
        VALUES (${key}, ${run.runId}, 'running', ${encodeCall(call)}, ${encodeAttributes(run.attributes)},
          ${child}, ${root}, ${origin.version})
        ON CONFLICT (call_key) DO NOTHING RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function startedByOf(database: HostDatabase, key: string): Effect.Effect<number | null, DatabaseFailed> {
  return rowsOf(
    StartedByRow,
    database.read(statement`SELECT started_by FROM workflow_calls WHERE call_key = ${key}`),
  ).pipe(Effect.map((rows) => rows[0]?.started_by ?? null));
}

export function refusedRow(
  database: HostDatabase,
  key: string,
  run: RunContext,
  refusal: CallResult,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`INSERT INTO workflow_calls (call_key, run_key, state, result) VALUES (${key}, ${run.runId},
        'answered', ${encodeResult(refusal)})
        ON CONFLICT (call_key) DO NOTHING RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export interface WaitingFrom {
  readonly child: string;
  readonly at: number;
  readonly resumesAfterMs?: number | undefined;
}

export function waitingRow(
  database: HostDatabase,
  key: string,
  { child, at, resumesAfterMs }: WaitingFrom,
): Effect.Effect<boolean, DatabaseFailed> {
  const dueAgainAt = resumesAfterMs === undefined ? null : at + resumesAfterMs;
  return database
    .write(
      statement`UPDATE workflow_calls SET state = 'waiting', child = ${child},
        resumes_after_ms = ${resumesAfterMs ?? null}, due_again_at = ${dueAgainAt}
        WHERE call_key = ${key} AND state = 'running' RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function dueAgainRow(database: HostDatabase, key: string, at: number): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`UPDATE workflow_calls SET due_again_at = ${at} WHERE call_key = ${key} AND state = 'waiting'`,
    ),
  );
}

export function cancelledRow(database: HostDatabase, key: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`UPDATE workflow_calls SET state = 'cancelled' WHERE call_key = ${key}
        AND state IN ('running', 'waiting')`,
    ),
  );
}

export function tombstonedRow(
  database: HostDatabase,
  key: string,
  runKey: string,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`INSERT INTO workflow_calls (call_key, run_key, state) VALUES (${key}, ${runKey}, 'cancelled')
        ON CONFLICT (call_key) DO NOTHING RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function answeredRow(
  database: HostDatabase,
  key: string,
  result: CallResult,
): Effect.Effect<boolean, DatabaseFailed> {
  return database
    .write(
      statement`UPDATE workflow_calls SET state = 'answered', result = ${encodeResult(result)}
        WHERE call_key = ${key} AND state IN ('running', 'waiting') RETURNING state`,
    )
    .pipe(Effect.map((rows) => rows.length > 0));
}

export function deliveredRow(database: HostDatabase, key: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(database.write(statement`UPDATE workflow_calls SET delivered = 1 WHERE call_key = ${key}`));
}

export function callRowOf(database: HostDatabase, key: string): Effect.Effect<CallRow | undefined, DatabaseFailed> {
  return rowsOf(
    CallRowSchema,
    database.read(statement`SELECT state, result, child FROM workflow_calls WHERE call_key = ${key}`),
  ).pipe(Effect.map((rows) => rows.at(0)));
}

export function existingRowOf(database: HostDatabase, key: string): Effect.Effect<CallRow, DatabaseFailed> {
  return oneRowOf(
    CallRowSchema,
    database.read(statement`SELECT state, result, child FROM workflow_calls WHERE call_key = ${key}`),
  );
}

export function openCallsUnder(database: HostDatabase, root: string): Effect.Effect<number, DatabaseFailed> {
  return oneRowOf(
    CountRow,
    database.read(
      statement`SELECT COUNT(*) AS open FROM workflow_calls WHERE root_id = ${root}
        AND state IN ('running', 'waiting')`,
    ),
  ).pipe(Effect.map(({ open }) => open));
}

function waitingOf(rows: readonly (typeof WaitingRow.Type)[]): readonly WaitingCall[] {
  return rows.map(({ call_key: key, call, child }) => ({ key, call, child }));
}

export function waitingCallsOf(
  database: HostDatabase,
  runKey: string,
): Effect.Effect<readonly WaitingCall[], DatabaseFailed> {
  return rowsOf(
    WaitingRow,
    database.read(
      statement`SELECT call_key, call, child FROM workflow_calls WHERE run_key = ${runKey} AND state = 'waiting'
        ORDER BY call_key`,
    ),
  ).pipe(Effect.map(waitingOf));
}

export function allWaitingCalls(database: HostDatabase): Effect.Effect<readonly WaitingCall[], DatabaseFailed> {
  return rowsOf(
    WaitingRow,
    database.read(
      statement`SELECT call_key, call, child FROM workflow_calls WHERE state = 'waiting' ORDER BY call_key`,
    ),
  ).pipe(Effect.map(waitingOf));
}

function callOfARunIn({
  call_key: key,
  run_key: runKey,
  call,
  attributes,
  started_by: version,
}: typeof StartedCallRow.Type): CallOfARun {
  return { key, call, run: { runId: runKey, attributes }, origin: { version } };
}

export function unfinishedCalls(database: HostDatabase): Effect.Effect<readonly UnfinishedCall[], DatabaseFailed> {
  return rowsOf(
    UnfinishedRow,
    database.read(
      statement`SELECT call_key, run_key, call, attributes, result, started_by FROM workflow_calls
        WHERE state = 'running' OR (state = 'answered' AND delivered = 0)`,
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => ({ ...callOfARunIn(row), result: row.result }))));
}

export function waitingDueBy(
  database: HostDatabase,
  now: number,
  most: number,
): Effect.Effect<readonly WaitingCallOfARun[], DatabaseFailed> {
  return rowsOf(
    DueCallRow,
    database.read(
      statement`SELECT call_key, run_key, call, attributes, started_by, child, resumes_after_ms FROM workflow_calls
        WHERE state = 'waiting' AND due_again_at <= ${now} ORDER BY due_again_at, call_key LIMIT ${most}`,
    ),
  ).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({ ...callOfARunIn(row), child: row.child, resumesAfterMs: row.resumes_after_ms })),
    ),
  );
}

export function soonestDueAfter(database: HostDatabase, moment: number): Effect.Effect<number | null, DatabaseFailed> {
  return oneRowOf(
    SoonestRow,
    database.read(
      statement`SELECT MIN(due_again_at) AS soonest FROM workflow_calls
        WHERE state = 'waiting' AND due_again_at > ${moment}`,
    ),
  ).pipe(Effect.map(({ soonest }) => soonest));
}
