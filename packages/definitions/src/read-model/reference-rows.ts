import type { ChildRowsProjection, ProjectedMessage, ProjectedRow, ProjectedRows } from '@on.auto/operations';

import { carriesContent, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import type { CallingStep, NamedDefinition } from '../used-by/called-definitions.ts';
import { namingDetailsOf } from '../used-by/definition-users.ts';
import { definitionFactOf, definitionKeyOf } from './definition-rows.ts';

interface Declared {
  readonly user: NamedDefinition;
  readonly used: NamedDefinition;
  readonly relation: 'calls' | 'reads';
  readonly places: readonly CallingStep[];
}

function childKeyOf({ relation, used }: Pick<Declared, 'relation' | 'used'>): string {
  return `${relation}/${used.type}/${used.name}`;
}

function referenceRow({ user, used, relation, places }: Declared): ProjectedRow {
  return {
    user_type: user.type,
    user_name: user.name,
    used_type: used.type,
    used_name: used.name,
    relation,
    places: JSON.stringify(places),
  };
}

function declaredBy(user: NamedDefinition, details: Parameters<typeof namingDetailsOf>[0]): readonly Declared[] {
  const { calls = [], reads = [] } = namingDetailsOf(details);
  const calling = new Map<string, Declared>();
  for (const { type, name, steps } of calls) {
    const used = { type, name };
    const before = calling.get(childKeyOf({ relation: 'calls', used }))?.places ?? [];
    calling.set(childKeyOf({ relation: 'calls', used }), {
      user,
      used,
      relation: 'calls',
      places: [...before, ...steps],
    });
  }
  const reading = reads.map(({ type, name }): Declared => ({
    user,
    used: { type, name },
    relation: 'reads',
    places: [],
  }));
  return [...[...calling.values()].filter(({ places }) => places.length > 0), ...reading];
}

function rowsDeclaredBy(fact: RecordedDefinitionEvent): ProjectedRows {
  if (!carriesContent(fact)) {
    return new Map();
  }
  const user = { type: fact.context.definitionType, name: fact.context.definitionName };
  return new Map(
    declaredBy(user, fact.data.content.details).map((declared): readonly [string, ProjectedRow] => [
      childKeyOf(declared),
      referenceRow(declared),
    ]),
  );
}

function referenceRowsAfter(_rows: ProjectedRows, message: ProjectedMessage): ProjectedRows | undefined {
  const fact = definitionFactOf(message);
  return fact === undefined || fact.type === 'definition_paused' || fact.type === 'definition_resumed'
    ? undefined
    : rowsDeclaredBy(fact);
}

export const definitionReferenceRows: ChildRowsProjection = {
  name: 'definition_references',
  version: 1,
  kinds: ['definitions'],
  types: ['definition_created', 'definition_updated', 'definition_restored', 'definition_retired'],
  columns: [
    { name: 'user_type', kind: 'text' },
    { name: 'user_name', kind: 'text' },
    { name: 'used_type', kind: 'text' },
    { name: 'used_name', kind: 'text' },
    { name: 'relation', kind: 'text' },
    { name: 'places', kind: 'text' },
  ],
  indexes: [{ name: 'by_used', columns: ['used_type', 'used_name', 'row_key', 'child_key'] }],
  keyOf: definitionKeyOf,
  rowsAfter: referenceRowsAfter,
};
