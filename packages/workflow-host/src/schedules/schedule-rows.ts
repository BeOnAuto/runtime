import { ScheduleTriggerSchema, type ScheduleTrigger } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { namedByTheirDefinitions } from '../triggers/trigger-rows.ts';

export interface Schedule {
  readonly playbookKey: string;
  readonly definitionKey: string;
  readonly version: number;
  readonly trigger: ScheduleTrigger;
  readonly activatedBy: string;
  readonly activatedAt: number;
  readonly nextDue: number;
  readonly heldDue: number | null;
  readonly running: string | null;
}

export interface NamedSchedule extends Schedule {
  readonly workflow: string;
}

const ScheduleRow = Schema.Struct({
  playbook_key: Schema.String,
  definition_key: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(ScheduleTriggerSchema),
  activated_by: Schema.String,
  activated_at: WholeNumber,
  next_due: WholeNumber,
  held_due: Schema.NullOr(WholeNumber),
  running: Schema.NullOr(Schema.String),
});

function scheduleOf(row: typeof ScheduleRow.Type): Schedule {
  return {
    playbookKey: row.playbook_key,
    definitionKey: row.definition_key,
    version: row.version,
    trigger: row.rule,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    nextDue: row.next_due,
    heldDue: row.held_due,
    running: row.running,
  };
}

export function dueSchedules(
  database: HostDatabase,
  now: number,
  limit: number,
): Effect.Effect<readonly NamedSchedule[]> {
  const due = Effect.orDie(
    rowsOf(
      ScheduleRow,
      Effect.orDie(
        database.read(
          statement`SELECT playbook_key, definition_key, version, rule, activated_by, activated_at, next_due, held_due,
              running
            FROM workflow_subscriptions
            WHERE kind <> 'event' AND next_due IS NOT NULL AND next_due <= ${now}
            ORDER BY next_due, definition_key, reference LIMIT ${limit}`,
        ),
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => scheduleOf(row))));
  return Effect.flatMap(due, (schedules: readonly Schedule[]) => namedByTheirDefinitions(database, schedules));
}

export function nextScheduleDue(database: HostDatabase): Effect.Effect<number | null> {
  return Effect.orDie(
    rowsOf(
      Schema.Struct({ due: Schema.NullOr(WholeNumber) }),
      Effect.orDie(
        database.read(statement`SELECT MIN(next_due) AS due FROM workflow_subscriptions WHERE next_due IS NOT NULL`),
      ),
    ),
  ).pipe(Effect.map((rows) => rows.reduce<number | null>((_, { due }) => due, null)));
}

export function scheduleMovedOn(
  database: HostDatabase,
  { definitionKey, trigger }: Pick<Schedule, 'definitionKey' | 'trigger'>,
  nextDue: number | null,
  running: string | null,
): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_subscriptions SET next_due = ${nextDue}, running = ${running}, held_due = NULL
          WHERE definition_key = ${definitionKey} AND reference = ${trigger.reference}`,
      ),
    ),
  );
}

export function scheduleHeld(
  database: HostDatabase,
  { definitionKey, trigger }: Pick<Schedule, 'definitionKey' | 'trigger'>,
  heldDue: number,
  triedAgainAt: number,
): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_subscriptions SET held_due = ${heldDue}, next_due = ${triedAgainAt}
          WHERE definition_key = ${definitionKey} AND reference = ${trigger.reference}`,
      ),
    ),
  );
}
