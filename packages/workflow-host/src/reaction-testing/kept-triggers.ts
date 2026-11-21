import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { restsOfTheHosts } from '../testing/signals.ts';
import { nameOfKey } from './playbook-writes.ts';

const TriggerRow = Schema.Struct({
  definition_key: Schema.String,
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

const PauseRow = Schema.Struct({ definition_key: Schema.String });

interface NamedTriggerRow extends Omit<typeof TriggerRow.Type, 'definition_key'> {
  readonly workflow: string | undefined;
}

function namedRowOf(row: typeof TriggerRow.Type): NamedTriggerRow {
  return {
    workflow: nameOfKey(row.definition_key),
    reference: row.reference,
    version: row.version,
    kind: row.kind,
    rule: row.rule,
    activated_by: row.activated_by,
    activated_at: row.activated_at,
    next_due: row.next_due,
    running: row.running,
  };
}

function inOrderOf({ workflow, reference }: NamedTriggerRow): string {
  return `${String(workflow)}\u0000${reference}`;
}

export async function triggerRowsOf(database: HostDatabase): Promise<readonly NamedTriggerRow[]> {
  const rows = await Effect.runPromise(
    rowsOf(
      TriggerRow,
      database.read(
        statement`SELECT definition_key, reference, version, kind, rule, activated_by, activated_at, next_due, running
          FROM workflow_subscriptions`,
      ),
    ),
  );
  return rows.map((row) => namedRowOf(row)).toSorted((one, other) => inOrderOf(one).localeCompare(inOrderOf(other)));
}

export async function pausesOf(database: HostDatabase): Promise<readonly (string | undefined)[]> {
  const rows = await Effect.runPromise(
    rowsOf(PauseRow, database.read(statement`SELECT definition_key FROM workflow_pauses ORDER BY definition_key`)),
  );
  return rows.map(({ definition_key: definitionKey }) => nameOfKey(definitionKey));
}

export function untilPaused(database: HostDatabase, paused: readonly string[]) {
  return restsOfTheHosts.whenRead(
    () => pausesOf(database),
    (found) => found.join() === paused.join(),
  );
}

export function refusalsOf(database: HostDatabase) {
  return Effect.runPromise(
    rowsOf(RefusalRow, database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
  );
}

export function untilTriggersAt(database: HostDatabase, workflow: string, version: number) {
  return restsOfTheHosts.whenRead(
    () => triggerRowsOf(database),
    (rows) => rows.some((row) => row.workflow === workflow && row.version === version),
  );
}

export function untilScheduleRuns(database: HostDatabase, reference: string) {
  return restsOfTheHosts.whenRead(
    () => triggerRowsOf(database),
    (rows) => rows.some((row) => row.reference === reference && row.running !== null),
  );
}

export function refusalsSaid(database: HostDatabase, count = 1) {
  return restsOfTheHosts.whenRead(
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
  return restsOfTheHosts.whenRead(
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
