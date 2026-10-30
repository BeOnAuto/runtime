import { Effect, Option, Schema } from 'effect';

import { defineQuery } from '../definition/operation.ts';
import { ActedContextSchema } from '../ledger/context.ts';
import { factOf } from '../ledger/decider.ts';
import { PlaybookReader } from '../ledger/playbook-reader.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const BeganSchema = factOf('run_began', Schema.Struct({ at: Schema.String, fn: Schema.String }), ActedContextSchema);

const EndedSchema = factOf(
  'run_ended',
  Schema.Struct({ status: Schema.Literals(['succeeded', 'failed', 'rejected']) }),
  ActedContextSchema,
);

const NotedSchema = factOf('run_noted', Schema.Struct({}), ActedContextSchema);

const decodeFact = Schema.decodeUnknownOption(Schema.Union([BeganSchema, EndedSchema, NotedSchema]));

export const tallyDueAfterMs = 60_000;

type TallyFact = Schema.Schema.Type<typeof BeganSchema | typeof EndedSchema | typeof NotedSchema>;

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: TallyFact,
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  if (fact.type === 'run_began') {
    const beganAt = Date.parse(fact.data.at);
    return {
      fn: fact.data.fn,
      began_at: beganAt,
      status: 'started',
      facts: 1,
      open: true,
      due_at: beganAt + tallyDueAfterMs,
      last_message: id,
    };
  }
  if (row === undefined) {
    return undefined;
  }
  const counted = { ...row, facts: Number(row['facts']) + 1, last_message: id };
  return fact.type === 'run_noted' ? counted : { ...counted, status: fact.data.status, open: false, due_at: null };
}

export function tallyRowsOf(version: number, fail?: (row: ProjectedRow) => boolean): KeyedProjection {
  return {
    name: 'run_tallies',
    kinds: ['runs'],
    version,
    types: ['run_began', 'run_ended', 'run_noted'],
    columns: [
      { name: 'fn', kind: 'text' },
      { name: 'began_at', kind: 'integer' },
      { name: 'status', kind: 'text' },
      { name: 'facts', kind: 'integer' },
      { name: 'open', kind: 'boolean' },
      { name: 'due_at', kind: 'integer' },
      { name: 'last_message', kind: 'text' },
    ],
    indexes: [
      { name: 'by_playbook_and_status', columns: ['status', 'began_at'] },
      { name: 'due', columns: ['due_at'], acrossPlaybooks: true, whereSet: 'due_at' },
    ],
    rowAfter: (row, message) =>
      Option.getOrUndefined(
        Option.flatMapNullishOr(decodeFact(message), (fact) => {
          const next = rowAfterFact(row, fact, message);
          if (next !== undefined && fail?.(next) === true) {
            throw new Error('The projection broke down');
          }
          return next;
        }),
      ),
  };
}

export const runTallyRows = tallyRowsOf(2);

export const readTallyRows = defineQuery('playbook', {
  name: 'read_tally_rows',
  title: 'Read tally rows',
  description: 'Reads the rows of the runs of the playbook that are still open, newest first, taking any limit.',
  route: { method: 'GET', path: '/tally-rows' },
  inputSchema: Schema.Struct({ limit: Schema.Int }),
  outputSchema: Schema.Struct({ runs: Schema.Array(Schema.String), open: Schema.Int }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ limit }) {
    const reader = yield* PlaybookReader;
    const where = [{ column: 'open', equals: true }];
    const rows = yield* reader.readProjectedRows('run_tallies', { where, orderBy: ['began_at'], order: 'desc', limit });
    return { runs: rows.map(({ key }) => key), open: yield* reader.countProjectedRows('run_tallies', where) };
  }),
});
