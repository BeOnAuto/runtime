import {
  definitionBoundStreamReader,
  type PlaybookAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectionReader,
  type StreamReader,
} from '@on.auto/operations';
import { Array as Arr, Effect, Option, Schema } from 'effect';

import { definitionRows } from '../read-model/definition-rows.ts';
import { runnableTriggersOf } from '../registry/definition-changes.ts';
import { TriggerSchema, type EventTrigger, type Trigger, type TriggerFilter } from '../registry/definition-triggers.ts';
import type { ReadModelRefused } from './read-model-refused.ts';
import { everyRowOf, saveOfTheRow, type ReadModelReader } from './read-model-rows.ts';

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

function rowsOfThePlaybook(ledger: Pick<ProjectionReader, 'readProjectedRows'>, playbook: PlaybookAddress) {
  return {
    readProjectedRows: (table: string, query: ProjectedRowsQuery) => ledger.readProjectedRows(table, playbook, query),
  };
}

export function connectionTriggersOf(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
): Effect.Effect<readonly ConnectionTrigger[]> {
  return Effect.map(everyRowOf(rowsOfThePlaybook(ledger, playbook), definitionRows.name, activeWithTriggers), (rows) =>
    rows.flatMap((row) => connectionTriggersIn(row)),
  );
}

export interface SavedEventTrigger {
  readonly definition: string;
  readonly reference: string;
  readonly filters: readonly TriggerFilter[];
}

export type ChosenFilter = (filter: TriggerFilter) => boolean;

export type ReadSavedTriggers = (
  playbook: PlaybookAddress,
  chosen: ChosenFilter,
) => Effect.Effect<readonly SavedEventTrigger[], ReadModelRefused>;

const SavedRowSchema = Schema.Struct({
  version: Schema.Number,
  saved_position: Schema.Number,
  triggers: Schema.NullOr(Schema.fromJsonString(Schema.Array(TriggerSchema))),
});

const savedRowOf = Schema.decodeUnknownEffect(SavedRowSchema);

function eventTriggersChosen(triggers: readonly Trigger[], chosen: ChosenFilter): readonly EventTrigger[] {
  return triggers.flatMap((trigger) => (trigger.kind === 'event' && trigger.filters.some(chosen) ? [trigger] : []));
}

function savedTriggersIn(
  reader: Pick<ReadModelReader, 'ofDefinition'>,
  chosen: ChosenFilter,
): (row: ProjectedKeyedRow) => Effect.Effect<readonly SavedEventTrigger[], ReadModelRefused> {
  return ({ definition, row }) =>
    Effect.flatMap(Effect.orDie(savedRowOf(row)), (saved) =>
      definition === undefined || eventTriggersChosen(saved.triggers ?? [], chosen).length === 0
        ? Effect.succeed([])
        : Effect.map(saveOfTheRow(reader, typeWithTriggers, definition, saved), ({ data }) =>
            eventTriggersChosen(runnableTriggersOf(data.content), chosen).map(({ reference, filters }) => ({
              definition,
              reference,
              filters,
            })),
          ),
    );
}

export function savedTriggersOf(ledger: Pick<ProjectionReader, 'readProjectedRows'> & StreamReader): ReadSavedTriggers {
  return (playbook, chosen) => {
    const reader = {
      ofDefinition: (definition: string) => definitionBoundStreamReader(ledger, { org: playbook.org, definition }),
    };
    return everyRowOf(rowsOfThePlaybook(ledger, playbook), definitionRows.name, activeWithTriggers).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, savedTriggersIn(reader, chosen))),
      Effect.map(Arr.flatten),
    );
  };
}
