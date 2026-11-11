import {
  EventTriggerSchema,
  ScheduleTriggerSchema,
  TriggerSchema,
  type ScheduleTrigger,
  type Trigger,
  type TriggerFilter,
} from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Effect, Result, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { firstDueOf } from '../schedules/schedule-times.ts';
import type { InZone } from '../schedules/zone-clock.ts';
import { triggerChangesOf, type TriggerChange } from './trigger-changes.ts';

export interface Activation {
  readonly workflow: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly activatedBy: string;
  readonly activatedAt: number;
}

interface Activating {
  readonly database: HostDatabase;
  readonly playbookKey: string;
  readonly activation: Activation;
  readonly inZone: InZone;
  readonly paused: boolean;
}

export interface EventPage {
  readonly type: string;
  readonly after: string | undefined;
  readonly most: number;
}

export interface EventSubscription {
  readonly workflow: string;
  readonly version: number;
  readonly reference: string;
  readonly filters: readonly TriggerFilter[];
}

const KeptRow = Schema.Struct({ rule: Schema.fromJsonString(TriggerSchema) });

const ScheduleRow = Schema.Struct({
  rule: Schema.fromJsonString(ScheduleTriggerSchema),
  activated_at: WholeNumber,
});

const PauseRow = Schema.Struct({ workflow: Schema.String });

const EventRow = Schema.Struct({
  workflow: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(EventTriggerSchema),
});

function typesKept(database: HostDatabase, playbookKey: string, workflow: string, types: readonly string[]) {
  return Effect.orDie(
    Effect.andThen(
      database.write(
        statement`DELETE FROM workflow_subscription_types WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
      Effect.forEach(
        [...new Set(types)],
        (type) =>
          database.write(
            statement`INSERT INTO workflow_subscription_types (playbook_key, workflow, type)
              VALUES (${playbookKey}, ${workflow}, ${type}) ON CONFLICT DO NOTHING`,
          ),
        { discard: true },
      ),
    ),
  );
}

function typesOf(triggers: readonly Trigger[]): readonly string[] {
  return triggers.flatMap((trigger) => (trigger.kind === 'event' ? trigger.filters.map(({ type }) => type) : []));
}

function firstDueAt(trigger: ScheduleTrigger, activatedAt: number, inZone: InZone, after = activatedAt): number | null {
  return Result.getOrElse(firstDueOf(trigger, activatedAt, inZone, after), () => after);
}

function firstDueOnActivation({ activation, inZone, paused }: Activating, trigger: Trigger): number | null {
  return trigger.kind === 'event' || paused ? null : firstDueAt(trigger, activation.activatedAt, inZone);
}

function keptTriggersOf(
  database: HostDatabase,
  playbookKey: string,
  workflow: string,
): Effect.Effect<readonly Trigger[]> {
  return Effect.orDie(
    rowsOf(
      KeptRow,
      database.read(
        statement`SELECT rule FROM workflow_subscriptions WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map(({ rule }) => rule)));
}

function activatedRow(activating: Activating, trigger: Trigger) {
  const { database, playbookKey, activation } = activating;
  const { workflow, version, activatedBy, activatedAt } = activation;
  return database.write(
    statement`INSERT INTO workflow_subscriptions
        (playbook_key, workflow, reference, version, kind, rule, activated_by, activated_at, next_due, running)
      VALUES (${playbookKey}, ${workflow}, ${trigger.reference}, ${version}, ${trigger.kind}, ${JSON.stringify(trigger)},
        ${activatedBy}, ${activatedAt}, ${firstDueOnActivation(activating, trigger)}, NULL)
      ON CONFLICT (playbook_key, workflow, reference) DO UPDATE SET version = excluded.version, kind = excluded.kind,
        rule = excluded.rule, activated_by = excluded.activated_by, activated_at = excluded.activated_at,
        next_due = excluded.next_due, held_due = NULL`,
  );
}

function rowWritten(activating: Activating, change: TriggerChange) {
  const { database, playbookKey, activation } = activating;
  const { workflow, version } = activation;
  if (change.change === 'activated') {
    return activatedRow(activating, change.trigger);
  }
  return change.change === 'kept'
    ? database.write(
        statement`UPDATE workflow_subscriptions SET version = ${version}
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND reference = ${change.trigger.reference}`,
      )
    : database.write(
        statement`DELETE FROM workflow_subscriptions
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND reference = ${change.reference}`,
      );
}

function isPaused(database: HostDatabase, playbookKey: string, workflow: string): Effect.Effect<boolean> {
  return Effect.orDie(
    rowsOf(
      PauseRow,
      database.read(
        statement`SELECT workflow FROM workflow_pauses WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.length > 0));
}

export function triggersActivated(database: HostDatabase, playbookKey: string, activation: Activation, inZone: InZone) {
  return Effect.gen(function* () {
    const kept = yield* keptTriggersOf(database, playbookKey, activation.workflow);
    const paused = yield* isPaused(database, playbookKey, activation.workflow);
    yield* Effect.orDie(
      Effect.forEach(
        triggerChangesOf(kept, activation.triggers),
        (change) => rowWritten({ database, playbookKey, activation, inZone, paused }, change),
        { discard: true },
      ),
    );
    yield* typesKept(database, playbookKey, activation.workflow, typesOf(activation.triggers));
  });
}

export function triggersRemoved(database: HostDatabase, playbookKey: string, workflow: string) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_subscriptions WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.andThen(typesKept(database, playbookKey, workflow, [])));
}

export function triggersRetired(database: HostDatabase, playbookKey: string, workflow: string) {
  return Effect.andThen(
    triggersRemoved(database, playbookKey, workflow),
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_pauses WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  );
}

export function triggersPaused(database: HostDatabase, playbookKey: string, workflow: string) {
  return Effect.asVoid(
    Effect.orDie(
      database.transaction([
        statement`UPDATE workflow_subscriptions SET next_due = NULL, held_due = NULL
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND kind <> 'event'`,
        statement`INSERT INTO workflow_pauses (playbook_key, workflow) VALUES (${playbookKey}, ${workflow})
          ON CONFLICT DO NOTHING`,
      ]),
    ),
  );
}

function schedulesOf(database: HostDatabase, playbookKey: string, workflow: string) {
  return Effect.orDie(
    rowsOf(
      ScheduleRow,
      database.read(
        statement`SELECT rule, activated_at FROM workflow_subscriptions
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND kind <> 'event'`,
      ),
    ),
  );
}

interface Resumption {
  readonly workflow: string;
  readonly resumedAt: number;
}

export function triggersResumed(
  database: HostDatabase,
  playbookKey: string,
  { workflow, resumedAt }: Resumption,
  inZone: InZone,
) {
  return Effect.gen(function* () {
    if (!(yield* isPaused(database, playbookKey, workflow))) {
      return;
    }
    const schedules = yield* schedulesOf(database, playbookKey, workflow);
    yield* Effect.orDie(
      database.transaction([
        ...schedules.map(
          ({ rule, activated_at: activatedAt }) =>
            statement`UPDATE workflow_subscriptions SET next_due = ${firstDueAt(rule, activatedAt, inZone, resumedAt)}
              WHERE playbook_key = ${playbookKey} AND workflow = ${workflow} AND reference = ${rule.reference}`,
        ),
        statement`DELETE FROM workflow_pauses WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ]),
    );
  });
}

export function eventSubscriptionsOf(
  database: HostDatabase,
  playbookKey: string,
  { type, after = '', most }: EventPage,
): Effect.Effect<readonly EventSubscription[]> {
  return Effect.orDie(
    rowsOf(
      EventRow,
      Effect.orDie(
        database.read(
          statement`SELECT s.workflow, s.version, s.rule FROM workflow_subscription_types t
            JOIN workflow_subscriptions s ON s.playbook_key = t.playbook_key AND s.workflow = t.workflow AND s.kind = 'event'
            WHERE t.playbook_key = ${playbookKey} AND t.type = ${type} AND t.workflow > ${after}
              AND NOT EXISTS (SELECT 1 FROM workflow_pauses p WHERE p.playbook_key = t.playbook_key AND p.workflow = t.workflow)
            ORDER BY t.workflow LIMIT ${most + 1}`,
        ),
      ),
    ),
  ).pipe(
    Effect.map((rows) =>
      rows.map(({ workflow, version, rule }) => ({
        workflow,
        version,
        reference: rule.reference,
        filters: rule.filters,
      })),
    ),
  );
}

const TypeRow = Schema.Struct({ type: Schema.String });

export function wantedTypesIn(database: HostDatabase, playbookKey: string): Effect.Effect<readonly string[]> {
  return Effect.orDie(
    rowsOf(
      TypeRow,
      database.read(
        statement`SELECT type FROM workflow_subscription_types WHERE playbook_key = ${playbookKey}
          UNION SELECT type FROM workflow_listener_types WHERE playbook_key = ${playbookKey}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map(({ type }) => type)));
}
