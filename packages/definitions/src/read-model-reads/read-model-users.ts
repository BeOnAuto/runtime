import type { PlaybookReader } from '@on.auto/operations';
import { Effect, Order, Schema } from 'effect';

import { definitionTypeRankOf } from '../capability/function-terminology.ts';
import { CallingStepSchema, type NamedDefinition } from '../used-by/called-definitions.ts';
import type { DefinitionUser } from '../used-by/user-relations.ts';
import { referencesTo, type ReferenceRow } from './read-model-rows.ts';

const decodeSteps = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(CallingStepSchema)));

const byTypeThenNameThenRelation = Order.combineAll([
  Order.mapInput(Order.Number, ({ type }: DefinitionUser) => definitionTypeRankOf(type)),
  Order.mapInput(Order.String, ({ type }: DefinitionUser) => type),
  Order.mapInput(Order.String, ({ name }: DefinitionUser) => name),
  Order.mapInput(Order.String, ({ relation }: DefinitionUser) => relation),
]);

function userOf({ user_type: type, user_name: name, relation, places }: ReferenceRow): DefinitionUser {
  return relation === 'calls' ? { type, name, relation, steps: decodeSteps(places) } : { type, name, relation };
}

export function usersFromTheReadModel(
  types: readonly string[],
  used: NamedDefinition,
): Effect.Effect<readonly DefinitionUser[], never, PlaybookReader> {
  return Effect.map(referencesTo(used.type, used.name), (rows) =>
    rows
      .filter(
        ({ user_type: type, user_name: name }) => types.includes(type) && !(type === used.type && name === used.name),
      )
      .map((row) => userOf(row))
      .toSorted(byTypeThenNameThenRelation),
  );
}
