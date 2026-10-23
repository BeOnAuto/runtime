import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { until } from '../testing/until.ts';

const TriggerRow = Schema.Struct({
  workflow: Schema.String,
  reference: Schema.String,
  version: WholeNumber,
  kind: Schema.String,
  rule: Schema.String,
  activated_by: Schema.String,
  activated_at: WholeNumber,
  next_due: Schema.NullOr(WholeNumber),
  running: Schema.NullOr(Schema.String),
});

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

export function triggerRowsOf(database: HostDatabase): Promise<readonly (typeof TriggerRow.Type)[]> {
  return Effect.runPromise(
    rowsOf(
      TriggerRow,
      database.read(
        statement`SELECT workflow, reference, version, kind, rule, activated_by, activated_at, next_due, running
          FROM workflow_subscriptions ORDER BY workflow, reference`,
      ),
    ),
  );
}

export function untilTriggersAt(database: HostDatabase, workflow: string, version: number) {
  return until(
    () => triggerRowsOf(database),
    (rows) => rows.some((row) => row.workflow === workflow && row.version === version),
  );
}

export function untilScheduleRuns(database: HostDatabase, reference: string) {
  return until(
    () => triggerRowsOf(database),
    (rows) => rows.some((row) => row.reference === reference && row.running !== null),
  );
}

export function refusalsSaid(database: HostDatabase, count = 1) {
  return until(
    () =>
      Effect.runPromise(
        rowsOf(RefusalRow, database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
      ),
    (found) => found.length >= count,
  );
}

export function startsReaching<Start extends ReactionStart>(
  starts: () => readonly Start[],
  count: number,
): Promise<readonly Start[]> {
  return until(
    () => Promise.resolve<readonly Start[]>([...starts()]),
    (found) => found.length >= count,
  );
}

export function runStillGoing(database: HostDatabase, runId: string) {
  return Effect.runPromise(
    database.write(statement`INSERT INTO workflow_runs (run_key, stream_id) VALUES (${`acme/alpha/${runId}`}, ${'s'})`),
  );
}

export function runEnded(database: HostDatabase, runId: string) {
  return Effect.runPromise(
    database.write(statement`UPDATE workflow_runs SET ended_at = 1 WHERE run_key = ${`acme/alpha/${runId}`}`),
  );
}
