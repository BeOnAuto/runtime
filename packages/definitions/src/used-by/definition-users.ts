import { Option, Order, Schema } from 'effect';

import { definitionTypeRankOf } from '../capability/function-terminology.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import { isRetired, type StoredDefinition } from '../registry/definition.ts';
import {
  CalledDefinitionSchema,
  NamedDefinitionSchema,
  type CalledDefinition,
  type CallingStep,
  type NamedDefinition,
} from './called-definitions.ts';
import type { DefinitionUser } from './user-relations.ts';

export type PlaybookRegistries = ReadonlyMap<string, DefinitionRegistry>;

const NamingDetailsSchema = Schema.Struct({
  calls: Schema.optionalKey(Schema.Array(CalledDefinitionSchema)),
  reads: Schema.optionalKey(Schema.Array(NamedDefinitionSchema)),
});

type NamingDetails = typeof NamingDetailsSchema.Type;

const decodeNamingDetails = Schema.decodeUnknownOption(NamingDetailsSchema);

type Use = { readonly relation: 'calls'; readonly steps: readonly CallingStep[] } | { readonly relation: 'reads' };

const byTypeThenName = Order.combineAll([
  Order.mapInput(Order.Number, ({ type }: DefinitionUser) => definitionTypeRankOf(type)),
  Order.mapInput(Order.String, ({ type }: DefinitionUser) => type),
  Order.mapInput(Order.String, ({ name }: DefinitionUser) => name),
]);

function namingDetailsOf(details: StoredDefinition['details']): NamingDetails {
  return Option.getOrElse(decodeNamingDetails(details), () => ({}));
}

function usesOfCalls(calls: readonly CalledDefinition[]): readonly Use[] {
  const steps = calls.flatMap((call) => call.steps);
  return steps.length === 0 ? [] : [{ relation: 'calls', steps }];
}

function isNamed({ type, name }: NamedDefinition, used: NamedDefinition): boolean {
  return type === used.type && name === used.name;
}

function usesOfReads(reads: readonly NamedDefinition[]): readonly Use[] {
  return reads.length === 0 ? [] : [{ relation: 'reads' }];
}

function usesOf({ calls = [], reads = [] }: NamingDetails, used: NamedDefinition): readonly Use[] {
  return [
    ...usesOfCalls(calls.filter((call) => isNamed(call, used))),
    ...usesOfReads(reads.filter((read) => isNamed(read, used))),
  ];
}

function userOf(user: NamedDefinition, use: Use): DefinitionUser {
  return { ...user, ...use };
}

function usersIn(type: string, registry: DefinitionRegistry, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registry.values()]
    .filter((definition) => !isRetired(definition) && !isNamed({ type, name: definition.name }, used))
    .flatMap(({ name, details }) => usesOf(namingDetailsOf(details), used).map((use) => userOf({ type, name }, use)));
}

export function usersOf(registries: PlaybookRegistries, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registries]
    .flatMap(([type, registry]: readonly [string, DefinitionRegistry]) => usersIn(type, registry, used))
    .toSorted(byTypeThenName);
}
