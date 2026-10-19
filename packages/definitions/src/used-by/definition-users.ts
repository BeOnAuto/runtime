import { Option, Order, Schema } from 'effect';

import { functionTypeOrder } from '../capability/function-terminology.ts';
import { isPlaybookRunEventType } from '../events/playbook-facts.ts';
import { definitionSourcePrefix } from '../events/reserved-attributes.ts';
import { isDefinitionEventType } from '../registry/definition-events.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import {
  CalledDefinitionSchema,
  type CalledDefinition,
  type CallingStep,
  type CallRole,
  type NamedDefinition,
  type UserRelation,
} from './called-definitions.ts';
import type { DefinitionCalled, DefinitionUser } from './user-relations.ts';

export type PlaybookRegistries = ReadonlyMap<string, DefinitionRegistry>;

const NamingFilterSchema = Schema.Struct({
  type: Schema.String,
  subject: Schema.optionalKey(Schema.Json),
  source: Schema.optionalKey(Schema.Json),
});

type NamingFilter = typeof NamingFilterSchema.Type;

const NamingDetailsSchema = Schema.Struct({
  calls: Schema.optionalKey(Schema.Array(CalledDefinitionSchema)),
  filters: Schema.optionalKey(Schema.Array(NamingFilterSchema)),
});

type NamingDetails = typeof NamingDetailsSchema.Type;

const decodeNamingDetails = Schema.decodeUnknownOption(NamingDetailsSchema);

const decodeTitle = Schema.decodeUnknownOption(Schema.Struct({ title: Schema.String }));

type NamingRelation = Exclude<UserRelation, 'calls'>;

type Use =
  | { readonly relation: 'calls'; readonly steps: readonly CallingStep[] }
  | { readonly relation: NamingRelation };

const relationsOfRoles: Readonly<Record<CallRole, NamingRelation>> = {
  trainer: 'sends-builds',
  approver: 'asks-approval',
};

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
  const steps = calls.flatMap((call) => ('steps' in call ? call.steps : []));
  const roles: readonly Use[] = calls.flatMap((call) =>
    'role' in call ? [{ relation: relationsOfRoles[call.role] }] : [],
  );
  return steps.length === 0 ? roles : [...roles, { relation: 'calls', steps }];
}

function relationsOfFilter({ type, subject, source }: NamingFilter, used: NamedDefinition): readonly NamingRelation[] {
  const named = `${used.type}/${used.name}`;
  if (isPlaybookRunEventType(type)) {
    return subject === named ? ['remembers-runs'] : [];
  }
  return isDefinitionEventType(type) && source === `${definitionSourcePrefix}${named}` ? ['remembers-changes'] : [];
}

function isNamed({ type, name }: NamedDefinition, used: NamedDefinition): boolean {
  return type === used.type && name === used.name;
}

function usesOf({ calls = [], filters = [] }: NamingDetails, used: NamedDefinition): readonly Use[] {
  const uses: readonly Use[] = [
    ...usesOfCalls(calls.filter((call) => isNamed(call, used))),
    ...filters.flatMap((filter) => relationsOfFilter(filter, used)).map((relation) => ({ relation })),
  ];
  return uses.filter((use, index) => uses.findIndex((other) => other.relation === use.relation) === index);
}

type Phrased = Pick<DefinitionUser, 'type' | 'name' | 'title'>;

function phrasedOf(type: string, name: string, details: StoredDefinition['details']): Phrased {
  return Option.match(decodeTitle(details), {
    onNone: () => ({ type, name }),
    onSome: ({ title }) => ({ type, name, title }),
  });
}

function userOf(phrased: Phrased, use: Use): DefinitionUser {
  return { ...phrased, ...use };
}

function usersIn(type: string, registry: DefinitionRegistry, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registry.values()]
    .filter(({ name, status }) => status === 'active' && !isNamed({ type, name }, used))
    .flatMap(({ name, details }) => {
      const uses = usesOf(namingDetailsOf(details), used);
      if (uses.length === 0) {
        return [];
      }
      const phrased = phrasedOf(type, name, details);
      return uses.map((use) => userOf(phrased, use));
    });
}

export function usersOf(registries: PlaybookRegistries, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registries]
    .flatMap(([type, registry]: readonly [string, DefinitionRegistry]) => usersIn(type, registry, used))
    .toSorted(byTypeThenName);
}

function calledAsHeld(registries: PlaybookRegistries, { type, name }: CalledDefinition): DefinitionCalled {
  const held = registries.get(type)?.get(name);
  if (held === undefined) {
    return { type, name, standing: 'missing' };
  }
  const { description } = held;
  return {
    ...phrasedOf(type, name, held.details),
    standing: held.status,
    ...(description === undefined ? {} : { description }),
  };
}

export function definitionsCalled(
  registries: PlaybookRegistries,
  details?: StoredDefinition['details'],
): readonly DefinitionCalled[] {
  const { calls = [] } = namingDetailsOf(details);
  return calls.filter((call) => 'steps' in call).map((call) => calledAsHeld(registries, call));
}
