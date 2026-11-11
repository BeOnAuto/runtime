import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect, Order } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { ListedDefinition } from '../registry/definition.ts';
import { listedOfTheRow, savedByOf } from './read-model-answers.ts';
import { definitionRowsOfType, type DefinitionRow } from './read-model-rows.ts';

const rowsByName = Order.mapInput(Order.String, ({ name }: DefinitionRow) => name);

type Reading<A> = Effect.Effect<A, never, PlaybookReader | PlaybookContext>;

export interface ListedRow {
  readonly row: DefinitionRow;
  readonly listed: ListedDefinition;
}

export function listedRowsFromTheReadModel(
  capability: Capability,
  includeRetired: boolean,
): Reading<readonly ListedRow[]> {
  return Effect.flatMap(definitionRowsOfType(capability.type), (rows) =>
    Effect.forEach(rows.filter((row) => includeRetired || row.status !== 'retired').toSorted(rowsByName), (row) =>
      Effect.map(savedByOf(capability.type, row.saved_position), (savedBy): ListedRow => ({
        row,
        listed: listedOfTheRow(capability, row, savedBy),
      })),
    ),
  );
}

export function listFromTheReadModel(
  capability: Capability,
  includeRetired: boolean,
): Reading<readonly ListedDefinition[]> {
  return Effect.map(listedRowsFromTheReadModel(capability, includeRetired), (rows) => rows.map(({ listed }) => listed));
}
