import {
  EventTriggerSchema,
  ScheduleTriggerSchema,
  TriggerSchema,
  type ScheduleTrigger,
  type Trigger,
  type TriggerFilter,
} from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Array as Arr, Effect, Result, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { firstDueOf } from '../schedules/schedule-times.ts';
import type { InZone } from '../schedules/zone-clock.ts';
import { triggerChangesOf, type TriggerChange } from './trigger-changes.ts';

export interface DefinitionPlace {
  readonly playbookKey: string;
  readonly definitionKey: string;
}

export interface Activation {
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly activatedBy: string;
  readonly activatedAt: number;
}

interface Activating {
  readonly database: HostDatabase;
  readonly place: DefinitionPlace;
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
  readonly definitionKey: string;
  readonly version: number;
  readonly reference: string;
  readonly filters: readonly TriggerFilter[];
}

const KeptRow = Schema.Struct({ rule: Schema.fromJsonString(TriggerSchema) });

const ScheduleRow = Schema.Struct({
  rule: Schema.fromJsonString(ScheduleTriggerSchema),
  activated_at: WholeNumber,
});

const PauseRow = Schema.Struct({ definition_key: Schema.String });

const EventRow = Schema.Struct({
  definition_key: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(EventTriggerSchema),
});

function typesKept(database: HostDatabase, { playbookKey, definitionKey }: DefinitionPlace, types: readonly string[]) {
  return Effect.orDie(
    Effect.andThen(
      database.write(statement`DELETE FROM workflow_subscription_types WHERE definition_key = ${definitionKey}`),
      Effect.forEach(
        [...new Set(types)],
        (type) =>
          database.write(
            statement`INSERT INTO workflow_subscription_types (definition_key, type, playbook_key)
              VALUES (${definitionKey}, ${type}, ${playbookKey}) ON CONFLICT DO NOTHING`,
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

function keptTriggersOf(database: HostDatabase, definitionKey: string): Effect.Effect<readonly Trigger[]> {
  return Effect.orDie(
    rowsOf(
      KeptRow,
      database.read(statement`SELECT rule FROM workflow_subscriptions WHERE definition_key = ${definitionKey}`),
    ),
  ).pipe(Effect.map((rows) => rows.map(({ rule }) => rule)));
}

function activatedRow(activating: Activating, trigger: Trigger) {
  const { database, place, activation } = activating;
  const { version, activatedBy, activatedAt } = activation;
  return database.write(
    statement`INSERT INTO workflow_subscriptions
        (definition_key, reference, playbook_key, version, kind, rule, activated_by, activated_at, next_due, running)
      VALUES (${place.definitionKey}, ${trigger.reference}, ${place.playbookKey}, ${version}, ${trigger.kind},
        ${JSON.stringify(trigger)}, ${activatedBy}, ${activatedAt}, ${firstDueOnActivation(activating, trigger)}, NULL)
      ON CONFLICT (definition_key, reference) DO UPDATE SET playbook_key = excluded.playbook_key,
        version = excluded.version, kind = excluded.kind, rule = excluded.rule, activated_by = excluded.activated_by,
        activated_at = excluded.activated_at, next_due = excluded.next_due, held_due = NULL`,
  );
}

function rowWritten(activating: Activating, change: TriggerChange) {
  const { database, place, activation } = activating;
  const { definitionKey } = place;
  if (change.change === 'activated') {
    return activatedRow(activating, change.trigger);
  }
  return change.change === 'kept'
    ? database.write(
        statement`UPDATE workflow_subscriptions SET version = ${activation.version}
          WHERE definition_key = ${definitionKey} AND reference = ${change.trigger.reference}`,
      )
    : database.write(
        statement`DELETE FROM workflow_subscriptions
          WHERE definition_key = ${definitionKey} AND reference = ${change.reference}`,
      );
}

function isPaused(database: HostDatabase, definitionKey: string): Effect.Effect<boolean> {
  return Effect.orDie(
    rowsOf(
      PauseRow,
      database.read(statement`SELECT definition_key FROM workflow_pauses WHERE definition_key = ${definitionKey}`),
    ),
  ).pipe(Effect.map((rows) => rows.length > 0));
}

export function triggersActivated(
  database: HostDatabase,
  place: DefinitionPlace,
  activation: Activation,
  inZone: InZone,
) {
  return Effect.gen(function* () {
    const kept = yield* keptTriggersOf(database, place.definitionKey);
    const paused = yield* isPaused(database, place.definitionKey);
    yield* Effect.orDie(
      Effect.forEach(
        triggerChangesOf(kept, activation.triggers),
        (change) => rowWritten({ database, place, activation, inZone, paused }, change),
        { discard: true },
      ),
    );
    yield* typesKept(database, place, typesOf(activation.triggers));
  });
}

export function triggersRemoved(database: HostDatabase, place: DefinitionPlace) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(statement`DELETE FROM workflow_subscriptions WHERE definition_key = ${place.definitionKey}`),
    ),
  ).pipe(Effect.andThen(typesKept(database, place, [])));
}

export function namedByTheirDefinitions<Row extends DefinitionPlace>(
  database: HostDatabase,
  rows: readonly Row[],
): Effect.Effect<readonly (Row & { readonly workflow: string })[]> {
  return Effect.map(
    Effect.forEach(rows, (row) =>
      Effect.flatMap(
        Effect.promise(() => database.store.nameHeldBy(row.definitionKey)),
        (held) =>
          held === undefined
            ? Effect.as(triggersRemoved(database, row), [])
            : Effect.succeed([{ ...row, workflow: held.name }]),
      ),
    ),
    Arr.flatten,
  );
}

export function triggersRetired(database: HostDatabase, place: DefinitionPlace) {
  return Effect.andThen(
    triggersRemoved(database, place),
    Effect.orDie(database.write(statement`DELETE FROM workflow_pauses WHERE definition_key = ${place.definitionKey}`)),
  );
}

export function triggersPaused(database: HostDatabase, { definitionKey }: DefinitionPlace) {
  return Effect.asVoid(
    Effect.orDie(
      database.transaction([
        statement`UPDATE workflow_subscriptions SET next_due = NULL, held_due = NULL
          WHERE definition_key = ${definitionKey} AND kind <> 'event'`,
        statement`INSERT INTO workflow_pauses (definition_key) VALUES (${definitionKey}) ON CONFLICT DO NOTHING`,
      ]),
    ),
  );
}

function schedulesOf(database: HostDatabase, definitionKey: string) {
  return Effect.orDie(
    rowsOf(
      ScheduleRow,
      database.read(
        statement`SELECT rule, activated_at FROM workflow_subscriptions
          WHERE definition_key = ${definitionKey} AND kind <> 'event'`,
      ),
    ),
  );
}

export function triggersResumed(
  database: HostDatabase,
  { definitionKey }: DefinitionPlace,
  resumedAt: number,
  inZone: InZone,
) {
  return Effect.gen(function* () {
    if (!(yield* isPaused(database, definitionKey))) {
      return;
    }
    const schedules = yield* schedulesOf(database, definitionKey);
    yield* Effect.orDie(
      database.transaction([
        ...schedules.map(
          ({ rule, activated_at: activatedAt }) =>
            statement`UPDATE workflow_subscriptions SET next_due = ${firstDueAt(rule, activatedAt, inZone, resumedAt)}
              WHERE definition_key = ${definitionKey} AND reference = ${rule.reference}`,
        ),
        statement`DELETE FROM workflow_pauses WHERE definition_key = ${definitionKey}`,
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
          statement`SELECT s.definition_key, s.version, s.rule FROM workflow_subscription_types t
            JOIN workflow_subscriptions s ON s.definition_key = t.definition_key AND s.kind = 'event'
            WHERE t.playbook_key = ${playbookKey} AND t.type = ${type} AND t.definition_key > ${after}
              AND NOT EXISTS (SELECT 1 FROM workflow_pauses p WHERE p.definition_key = t.definition_key)
            ORDER BY t.definition_key LIMIT ${most + 1}`,
        ),
      ),
    ),
  ).pipe(
    Effect.map((rows) =>
      rows.map(({ definition_key: definitionKey, version, rule }) => ({
        definitionKey,
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
