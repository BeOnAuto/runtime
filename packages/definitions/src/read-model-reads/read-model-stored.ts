import { type NotFound, type PlaybookContext, type PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { definitionNotFound } from '../registry/registry-lookup.ts';
import { savedByOf, storedOf } from './read-model-answers.ts';
import type { ReadModelRefused } from './read-model-refused.ts';
import { rowAndSaveOf, type DefinitionRow } from './read-model-rows.ts';

type Reading<A, E = never> = Effect.Effect<A, E | ReadModelRefused, PlaybookReader | PlaybookContext>;

export interface RegisteredInTheReadModel {
  readonly stored: RegisteredDefinition;
  readonly row: DefinitionRow;
  readonly savedBy: string;
}

export function registeredFromTheReadModel(type: string, name: string): Reading<RegisteredInTheReadModel | undefined> {
  return Effect.flatMap(rowAndSaveOf(type, name), (found) =>
    found === undefined
      ? Effect.undefined
      : Effect.map(savedByOf(type, found.row.saved_position), (savedBy) => ({
          stored: storedOf(found),
          row: found.row,
          savedBy,
        })),
  );
}

export function storedFromTheReadModel(type: string, name: string): Reading<RegisteredInTheReadModel, NotFound> {
  return Effect.flatMap(registeredFromTheReadModel(type, name), (found) =>
    found === undefined ? Effect.fail(definitionNotFound(type, name)) : Effect.succeed(found),
  );
}
