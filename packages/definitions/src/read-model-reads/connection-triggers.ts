import type {
  PlaybookAddress,
  ProjectedCondition,
  ProjectedKeyedRow,
  ProjectedRowsQuery,
  ProjectionReader,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { definitionRows } from '../read-model/definition-rows.ts';
import { TriggerSchema, type TriggerFilter } from '../registry/definition-triggers.ts';
import { everyRowOf } from './read-model-rows.ts';

interface ConnectionTrigger {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
}

const typeWithTriggers = 'workflow';

const connectionSourcePrefix = '/connections/';

export const connectionTriggerFacts: readonly string[] = [
  'definition_created',
  'definition_updated',
  'definition_retired',
  'definition_paused',
  'definition_resumed',
  'definition_restored',
  'definition_moved',
];

interface FactOfADefinition {
  readonly type: string;
  readonly context: { readonly definitionType?: string };
}

export function changesConnectionTriggers({ type, context }: FactOfADefinition): boolean {
  return context.definitionType === typeWithTriggers && connectionTriggerFacts.includes(type);
}

const activeWithTriggers: readonly ProjectedCondition[] = [
  { column: 'definition_type', equals: typeWithTriggers },
  { column: 'status', equals: 'active' },
];

const triggersOfTheRow = Schema.decodeUnknownOption(
  Schema.Struct({ triggers: Schema.fromJsonString(Schema.Array(TriggerSchema)) }),
);

function connectionTriggerOf({ type, attributes }: TriggerFilter): readonly ConnectionTrigger[] {
  const { source, subject } = attributes;
  if (typeof source !== 'string' || !source.startsWith(connectionSourcePrefix)) {
    return [];
  }
  const connection = source.slice(connectionSourcePrefix.length);
  return [typeof subject === 'string' ? { connection, type, subject } : { connection, type }];
}

function connectionTriggersIn({ row }: ProjectedKeyedRow): readonly ConnectionTrigger[] {
  const triggers = Option.match(triggersOfTheRow(row), { onNone: () => [], onSome: (read) => read.triggers });
  return triggers.flatMap((trigger) =>
    trigger.kind === 'event' ? trigger.filters.flatMap((filter) => connectionTriggerOf(filter)) : [],
  );
}

export function connectionTriggersOf(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
): Effect.Effect<readonly ConnectionTrigger[]> {
  const inThePlaybook = {
    readProjectedRows: (table: string, query: ProjectedRowsQuery) => ledger.readProjectedRows(table, playbook, query),
  };
  return Effect.map(everyRowOf(inThePlaybook, definitionRows.name, activeWithTriggers), (rows) =>
    rows.flatMap((row) => connectionTriggersIn(row)),
  );
}
