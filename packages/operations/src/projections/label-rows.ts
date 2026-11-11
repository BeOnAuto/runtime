import { Option, Result, Schema } from 'effect';

import { ActedContextSchema, type Context } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { ChildRowsProjection, ProjectedMessage, ProjectedRow, ProjectedRows } from './keyed-projection.ts';

const SetSchema = factOf(
  'labels_set',
  Schema.Struct({ note: Schema.String, labels: Schema.Array(Schema.String) }),
  ActedContextSchema,
);

const AddedSchema = factOf(
  'label_added',
  Schema.Struct({ note: Schema.String, label: Schema.String }),
  ActedContextSchema,
);

const ClearedSchema = factOf('labels_cleared', Schema.Struct({ note: Schema.String }), ActedContextSchema);

export const LabelFactSchema = Schema.Union([SetSchema, AddedSchema, ClearedSchema]);

type RecordedLabelFact = typeof LabelFactSchema.Type;

export type LabelFact = Decided<RecordedLabelFact>;

export const labelledContext: Context = { at: '2026-11-11T09:00:00.000Z', by: 'labeller' };

export const labelFacts: Decider<null, readonly LabelFact[], RecordedLabelFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => labelledContext,
  eventSchema: LabelFactSchema,
};

const decodeFact = Schema.decodeUnknownOption(LabelFactSchema);

function labelRow(label: string, place: number, { position }: ProjectedMessage): ProjectedRow {
  return { label, place, set_at: position };
}

function rowsAfterFact(
  rows: ProjectedRows,
  fact: RecordedLabelFact,
  message: ProjectedMessage,
): ProjectedRows | undefined {
  if (fact.type === 'labels_cleared') {
    return new Map();
  }
  if (fact.type === 'label_added') {
    const { label } = fact.data;
    return rows.has(label) ? undefined : new Map([...rows, [label, labelRow(label, rows.size + 1, message)]]);
  }
  return new Map(fact.data.labels.map((label, at) => [label, labelRow(label, at + 1, message)]));
}

export const labelRows: ChildRowsProjection = {
  name: 'labels',
  version: 1,
  kinds: ['notes'],
  types: ['labels_set', 'label_added', 'labels_cleared'],
  columns: [
    { name: 'label', kind: 'text' },
    { name: 'place', kind: 'integer' },
    { name: 'set_at', kind: 'integer' },
  ],
  indexes: [{ name: 'by_label', columns: ['label', 'row_key', 'child_key'] }],
  rowsAfter: (rows, message) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(message), (fact) => rowsAfterFact(rows, fact, message))),
};

export const labelRowsByNote: ChildRowsProjection = {
  ...labelRows,
  name: 'note_labels',
  kinds: ['notes', 'others'],
  keyOf: (message) => Option.getOrUndefined(Option.map(decodeFact(message), ({ data }) => data.note)),
};
