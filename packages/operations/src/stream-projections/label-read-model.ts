import { Schema } from 'effect';

import type { KeyedProjection } from '../projections/keyed-projection.ts';
import { labelRows } from '../projections/label-rows.ts';
import type { StreamProjection } from './stream-projection.ts';

const decodeSet = Schema.decodeUnknownSync(Schema.Struct({ note: Schema.String, labels: Schema.Array(Schema.String) }));

export const labelSets: KeyedProjection = {
  name: 'label_sets',
  version: 1,
  kinds: ['notes'],
  types: ['labels_set'],
  columns: [
    { name: 'note', kind: 'text' },
    { name: 'labels', kind: 'integer' },
    { name: 'set_at', kind: 'integer' },
  ],
  indexes: [],
  keyOf: ({ position }, { id }) => `${id}/${position}`,
  rowAfter: (_row, { data, position }) => {
    const { note, labels } = decodeSet(data);
    return { note, labels: labels.length, set_at: position };
  },
};

export const labelNotes: KeyedProjection = {
  name: 'label_notes',
  version: 1,
  kinds: ['notes'],
  types: ['labels_set'],
  columns: [
    { name: 'note', kind: 'text' },
    { name: 'last_set_at', kind: 'integer' },
  ],
  indexes: [],
  keyOf: ({ data }) => decodeSet(data).note,
  rowAfter: (_row, { data, position }) => ({ note: decodeSet(data).note, last_set_at: position }),
};

function ofTheVersion(table: KeyedProjection, version: number): KeyedProjection {
  return { ...table, version };
}

export function labelReadModelOf(
  version = 1,
  tables: readonly KeyedProjection[] = [labelSets, labelNotes],
): StreamProjection {
  return {
    name: 'labelled',
    version,
    kind: 'notes',
    streams: ['n1', 'n2'],
    tables: [...tables.map((table) => ofTheVersion(table, version)), { ...labelRows, name: 'labelled_rows', version }],
    counted: [{ projection: 'label_sets', facts: ['labels_set'] }],
    groupwiseMaxima: [
      {
        projection: 'label_notes',
        groups: 'label_sets',
        groupedBy: ['note'],
        greatest: 'set_at',
        matching: [{ column: 'last_set_at', equals: 'set_at' }],
      },
    ],
  };
}
