import { reactionRefusalDecider, ReactionRefusedSchema, reactionsStreamKind } from '@on.auto/definitions';
import { decisionLoop, eventAppenderOf, statement } from '@on.auto/ledger';
import {
  RejectionBecauseSchema,
  RejectionKindSchema,
  StartingTriggerSchema,
  type RejectionBecause,
  type RejectionKind,
  type StartingTrigger,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { playbookOfKey } from '../follower/record-steps.ts';

export interface RejectionCodes {
  readonly kind?: RejectionKind;
  readonly because?: RejectionBecause;
}

export interface FailureDetail extends RejectionCodes {
  readonly detail: string;
}

export function codesOf({ kind, because }: RejectionCodes): RejectionCodes {
  return { ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

export interface Refusal extends RejectionCodes {
  readonly workflow: string;
  readonly version: number;
  readonly reason: string;
  readonly trigger?: StartingTrigger;
}

export interface RefuseReaction {
  readonly refuse: (playbookKey: string, refusal: Refusal) => Effect.Effect<void>;
}

export interface Refusals extends RefuseReaction {
  readonly flush: () => Effect.Effect<number>;
}

const refusalFields = {
  playbook_key: Schema.String,
  workflow: Schema.String,
  version: WholeNumber,
  minute: WholeNumber,
  count: WholeNumber,
  reason: Schema.String,
  recorded: WholeNumber,
  kind: Schema.NullOr(RejectionKindSchema),
  because: Schema.NullOr(RejectionBecauseSchema),
};

const RefusalRow = Schema.Union([
  Schema.Struct({ ...refusalFields, trigger_kind: Schema.Null, trigger_reference: Schema.Null }),
  Schema.Struct({
    ...refusalFields,
    trigger_kind: StartingTriggerSchema.fields.kind,
    trigger_reference: StartingTriggerSchema.fields.reference,
  }),
]);

type Row = typeof RefusalRow.Type;

const aMinute = 60_000;

function minuteOf(at: number): number {
  return Math.floor(at / aMinute) * aMinute;
}

export function reactionsStreamOf(playbookKey: string, workflow: string): string {
  return `${playbookKey}${reactionsStreamKind}/${workflow}`;
}

function refusalLoopOn(database: HostDatabase) {
  const append = eventAppenderOf(database.store, ReactionRefusedSchema);
  return decisionLoop(
    (stream: string) =>
      Effect.map(
        Effect.promise(() => database.store.versionOf(stream)),
        (version) => ({ state: null, version }),
      ),
    (stream, events, place) => append(stream, events, place),
    reactionRefusalDecider,
  );
}

function triggerOf(row: Row) {
  return row.trigger_kind === null ? {} : { trigger: { kind: row.trigger_kind, reference: row.trigger_reference } };
}

function refusedOf(row: Row) {
  const { count, reason, minute, kind, because } = row;
  return {
    count,
    reason,
    minute: new Date(minute).toISOString(),
    ...(kind === null ? {} : { kind }),
    ...(because === null ? {} : { because }),
    ...triggerOf(row),
  };
}

function recorded(database: HostDatabase, row: Row, at: number): Effect.Effect<void> {
  const refusal = {
    playbook: playbookOfKey(row.playbook_key),
    workflow: row.workflow,
    version: row.version,
    refused: refusedOf(row),
    at: new Date(at).toISOString(),
  };
  return Effect.orDie(
    Effect.gen(function* () {
      yield* refusalLoopOn(database)(reactionsStreamOf(row.playbook_key, row.workflow), refusal);
      yield* database.write(
        statement`UPDATE workflow_reaction_refusals SET recorded = 1
          WHERE playbook_key = ${row.playbook_key} AND workflow = ${row.workflow} AND minute = ${row.minute}`,
      );
    }),
  );
}

function rowOf(database: HostDatabase, playbookKey: string, workflow: string): Effect.Effect<Row | undefined> {
  return Effect.orDie(
    rowsOf(
      RefusalRow,
      database.read(
        statement`SELECT playbook_key, workflow, version, minute, count, reason, recorded,
            kind, because, trigger_kind, trigger_reference
          FROM workflow_reaction_refusals
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => row));
}

function counted(database: HostDatabase, playbookKey: string, refusal: Refusal, minute: number) {
  const { workflow, version, reason, kind = null, because = null, trigger } = refusal;
  const triggerKind = trigger?.kind ?? null;
  const triggerReference = trigger?.reference ?? null;
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_refusals
          (playbook_key, workflow, version, minute, count, reason, recorded, kind, because, trigger_kind, trigger_reference)
        VALUES (${playbookKey}, ${workflow}, ${version}, ${minute}, 1, ${reason}, 0,
          ${kind}, ${because}, ${triggerKind}, ${triggerReference})
        ON CONFLICT (playbook_key, workflow) DO UPDATE SET
          count = CASE WHEN workflow_reaction_refusals.minute = excluded.minute
            THEN workflow_reaction_refusals.count + 1 ELSE 1 END,
          version = excluded.version, minute = excluded.minute, reason = excluded.reason, recorded = 0,
          kind = excluded.kind, because = excluded.because,
          trigger_kind = excluded.trigger_kind, trigger_reference = excluded.trigger_reference`,
    ),
  );
}

export function refusalsOn(database: HostDatabase, now: () => number): Refusals {
  return {
    refuse: (playbookKey, refusal) =>
      Effect.gen(function* () {
        const at = now();
        const row = yield* rowOf(database, playbookKey, refusal.workflow);
        if (row !== undefined && row.minute !== minuteOf(at) && row.recorded === 0) {
          yield* recorded(database, row, at);
        }
        yield* counted(database, playbookKey, refusal, minuteOf(at));
      }),
    flush: () =>
      Effect.gen(function* () {
        const at = now();
        const due = yield* Effect.orDie(
          rowsOf(
            RefusalRow,
            database.read(
              statement`SELECT playbook_key, workflow, version, minute, count, reason, recorded,
                  kind, because, trigger_kind, trigger_reference
                FROM workflow_reaction_refusals
                WHERE recorded = 0 AND minute < ${minuteOf(at)}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (row) => recorded(database, row, at), { discard: true });
        return due.length;
      }),
  };
}
