import { reactionRefusalDecider, ReactionRefusedSchema, reactionsStreamKind } from '@on.auto/definitions';
import { decisionLoop, eventAppenderOf, statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { playbookOfKey } from '../follower/record-steps.ts';

interface RefusedWorkflow {
  readonly workflow: string;
  readonly version: number;
}

export interface RefuseReaction {
  readonly refuse: (playbookKey: string, refused: RefusedWorkflow, reason: string) => Effect.Effect<void>;
}

export interface Refusals extends RefuseReaction {
  readonly flush: () => Effect.Effect<number>;
}

const RefusalRow = Schema.Struct({
  playbook_key: Schema.String,
  workflow: Schema.String,
  version: WholeNumber,
  minute: WholeNumber,
  count: WholeNumber,
  reason: Schema.String,
  recorded: WholeNumber,
});

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
        Effect.promise(() => database.store.read(stream)),
        ({ version }) => ({ state: null, version }),
      ),
    (stream, events, place) => append(stream, events, place),
    reactionRefusalDecider,
  );
}

function recorded(database: HostDatabase, row: Row, at: number): Effect.Effect<void> {
  const refusal = {
    playbook: playbookOfKey(row.playbook_key),
    workflow: row.workflow,
    version: row.version,
    refused: { count: row.count, reason: row.reason, minute: new Date(row.minute).toISOString() },
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
        statement`SELECT playbook_key, workflow, version, minute, count, reason, recorded FROM workflow_reaction_refusals
          WHERE playbook_key = ${playbookKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => row));
}

interface Counted extends RefusedWorkflow {
  readonly playbookKey: string;
  readonly reason: string;
  readonly minute: number;
}

function counted(database: HostDatabase, { playbookKey, workflow, version, reason, minute }: Counted) {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_refusals (playbook_key, workflow, version, minute, count, reason, recorded)
        VALUES (${playbookKey}, ${workflow}, ${version}, ${minute}, 1, ${reason}, 0)
        ON CONFLICT (playbook_key, workflow) DO UPDATE SET
          count = CASE WHEN workflow_reaction_refusals.minute = excluded.minute
            THEN workflow_reaction_refusals.count + 1 ELSE 1 END,
          version = excluded.version, minute = excluded.minute, reason = excluded.reason, recorded = 0`,
    ),
  );
}

export function refusalsOn(database: HostDatabase, now: () => number): Refusals {
  return {
    refuse: (playbookKey, { workflow, version }, reason) =>
      Effect.gen(function* () {
        const at = now();
        const row = yield* rowOf(database, playbookKey, workflow);
        if (row !== undefined && row.minute !== minuteOf(at) && row.recorded === 0) {
          yield* recorded(database, row, at);
        }
        yield* counted(database, { playbookKey, workflow, version, reason, minute: minuteOf(at) });
      }),
    flush: () =>
      Effect.gen(function* () {
        const at = now();
        const due = yield* Effect.orDie(
          rowsOf(
            RefusalRow,
            database.read(
              statement`SELECT playbook_key, workflow, version, minute, count, reason, recorded FROM workflow_reaction_refusals
                WHERE recorded = 0 AND minute < ${minuteOf(at)}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (row) => recorded(database, row, at), { discard: true });
        return due.length;
      }),
  };
}
