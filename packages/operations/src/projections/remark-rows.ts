import { Option, Result, Schema } from 'effect';

import { ActedContextSchema, type Context } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const MadeSchema = factOf('remark_made', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const ErasedSchema = factOf('remark_erased', Schema.Struct({ position: Schema.Int }), ActedContextSchema);

export const RemarkFactSchema = Schema.Union([MadeSchema, ErasedSchema]);

type RecordedRemarkFact = typeof RemarkFactSchema.Type;

export type RemarkFact = Decided<RecordedRemarkFact>;

export const remarkedContext: Context = { at: '2026-10-05T09:00:00.000Z', by: 'remarker' };

export const remarkFacts: Decider<null, readonly RemarkFact[], RecordedRemarkFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => remarkedContext,
  eventSchema: RemarkFactSchema,
};

const decodeFact = Schema.decodeUnknownOption(RemarkFactSchema);

function countOf(row: ProjectedRow | undefined, column: string): number {
  return Number(row?.[column] ?? 0);
}

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: RecordedRemarkFact,
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  if (fact.type === 'remark_made') {
    return {
      text: fact.data.text,
      remarks: countOf(row, 'remarks') + 1,
      erasures: countOf(row, 'erasures'),
      last_message: id,
    };
  }
  return row === undefined ? undefined : { ...row, erasures: countOf(row, 'erasures') + 1, last_message: id };
}

export const remarkRows: KeyedProjection = {
  name: 'remarks',
  version: 1,
  scopes: ['playbook', 'org'],
  kinds: ['remarks'],
  types: ['remark_made', 'remark_erased'],
  columns: [
    { name: 'text', kind: 'text' },
    { name: 'remarks', kind: 'integer' },
    { name: 'erasures', kind: 'integer' },
    { name: 'last_message', kind: 'text' },
  ],
  indexes: [{ name: 'by_text', columns: ['text'] }],
  rowAfter: (row, message) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(message), (fact) => rowAfterFact(row, fact, message))),
};
