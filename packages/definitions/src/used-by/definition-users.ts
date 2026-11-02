import { Option, Order, Schema } from 'effect';

import { functionTypeOrder } from '../capability/function-terminology.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import {
  CalledDefinitionSchema,
  type CalledDefinition,
  type CallingStep,
  type NamedDefinition,
} from './called-definitions.ts';
import type { DefinitionUser } from './user-relations.ts';

export type PlaybookRegistries = ReadonlyMap<string, DefinitionRegistry>;

const NamingDetailsSchema = Schema.Struct({
  calls: Schema.optionalKey(Schema.Array(CalledDefinitionSchema)),
});

type NamingDetails = typeof NamingDetailsSchema.Type;

const decodeNamingDetails = Schema.decodeUnknownOption(NamingDetailsSchema);

interface Use {
  readonly relation: 'calls';
  readonly steps: readonly CallingStep[];
}

const typeRanks: readonly string[] = [...functionTypeOrder, 'workflow'];

function rankOf({ type }: DefinitionUser): number {
  const rank = typeRanks.indexOf(type);
  return rank === -1 ? typeRanks.length : rank;
}

const byTypeThenName = Order.combineAll([
  Order.mapInput(Order.Number, rankOf),
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

function usesOf({ calls = [] }: NamingDetails, used: NamedDefinition): readonly Use[] {
  return usesOfCalls(calls.filter((call) => isNamed(call, used)));
}

function userOf(user: NamedDefinition, use: Use): DefinitionUser {
  return { ...user, ...use };
}

function usersIn(type: string, registry: DefinitionRegistry, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registry.values()]
    .filter(({ name, status }) => status === 'active' && !isNamed({ type, name }, used))
    .flatMap(({ name, details }) => usesOf(namingDetailsOf(details), used).map((use) => userOf({ type, name }, use)));
}

export function usersOf(registries: PlaybookRegistries, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registries]
    .flatMap(([type, registry]: readonly [string, DefinitionRegistry]) => usersIn(type, registry, used))
    .toSorted(byTypeThenName);
}
