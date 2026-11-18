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
  readonly definitionKey: string;
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
  definition_key: Schema.String,
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
  Schema.Struct({ ...refusalFields, trigger_kind: Schema.Literal(''), trigger_reference: Schema.Literal('') }),
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

export function reactionsStreamOf(definitionKey: string, definitionType: string): string {
  return `${definitionKey}${reactionsStreamKind}/${definitionType}`;
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
  return row.trigger_kind === '' ? {} : { trigger: { kind: row.trigger_kind, reference: row.trigger_reference } };
}

function triggerColumnsOf({ trigger }: Refusal) {
  return { triggerKind: trigger?.kind ?? '', triggerReference: trigger?.reference ?? '' };
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

interface Recording {
  readonly database: HostDatabase;
  readonly definitionType: string;
}

function recorded({ database, definitionType }: Recording, row: Row, at: number): Effect.Effect<void> {
  const refusal = {
    playbook: playbookOfKey(row.playbook_key),
    workflow: row.workflow,
    version: row.version,
    refused: refusedOf(row),
    at: new Date(at).toISOString(),
  };
  return Effect.orDie(
    Effect.gen(function* () {
      yield* refusalLoopOn(database)(reactionsStreamOf(row.definition_key, definitionType), refusal);
      yield* database.write(
        statement`UPDATE workflow_reaction_refusals SET recorded = 1
          WHERE definition_key = ${row.definition_key}
            AND trigger_kind = ${row.trigger_kind} AND trigger_reference = ${row.trigger_reference}
            AND minute = ${row.minute}`,
      );
    }),
  );
}

function rowOf(database: HostDatabase, refusal: Refusal): Effect.Effect<Row | undefined> {
  const { triggerKind, triggerReference } = triggerColumnsOf(refusal);
  return Effect.orDie(
    rowsOf(
      RefusalRow,
      database.read(
        statement`SELECT definition_key, playbook_key, workflow, version, minute, count, reason, recorded,
            kind, because, trigger_kind, trigger_reference
          FROM workflow_reaction_refusals
          WHERE definition_key = ${refusal.definitionKey}
            AND trigger_kind = ${triggerKind} AND trigger_reference = ${triggerReference}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => row));
}

function counted(database: HostDatabase, playbookKey: string, refusal: Refusal, minute: number) {
  const { definitionKey, workflow, version, reason, kind = null, because = null } = refusal;
  const { triggerKind, triggerReference } = triggerColumnsOf(refusal);
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_refusals (definition_key, playbook_key, workflow, version, minute, count,
          reason, recorded, kind, because, trigger_kind, trigger_reference)
        VALUES (${definitionKey}, ${playbookKey}, ${workflow}, ${version}, ${minute}, 1, ${reason}, 0,
          ${kind}, ${because}, ${triggerKind}, ${triggerReference})
        ON CONFLICT (definition_key, trigger_kind, trigger_reference) DO UPDATE SET
          count = CASE WHEN workflow_reaction_refusals.minute = excluded.minute
            THEN workflow_reaction_refusals.count + 1 ELSE 1 END,
          playbook_key = excluded.playbook_key, workflow = excluded.workflow, version = excluded.version, minute = excluded.minute, reason = excluded.reason, recorded = 0,
          kind = excluded.kind, because = excluded.because`,
    ),
  );
}

export function refusalsOn(database: HostDatabase, definitionType: string, now: () => number): Refusals {
  const recording = { database, definitionType };
  return {
    refuse: (playbookKey, refusal) =>
      Effect.gen(function* () {
        const at = now();
        const row = yield* rowOf(database, refusal);
        if (row !== undefined && row.minute !== minuteOf(at) && row.recorded === 0) {
          yield* recorded(recording, row, at);
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
              statement`SELECT definition_key, playbook_key, workflow, version, minute, count, reason, recorded,
                  kind, because, trigger_kind, trigger_reference
                FROM workflow_reaction_refusals
                WHERE recorded = 0 AND minute < ${minuteOf(at)}
                ORDER BY minute, definition_key, trigger_kind, trigger_reference`,
            ),
          ),
        );
        yield* Effect.forEach(due, (row) => recorded(recording, row, at), { discard: true });
        return due.length;
      }),
  };
}
