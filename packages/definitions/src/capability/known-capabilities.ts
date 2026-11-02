import { NotFound, type JsonSchemaDocument, type RouteRegistration } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { isDefinitionTypeName, type Capability } from './capability.ts';
import type { DefinitionKind } from './definition-kinds.ts';

interface PublishedOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

const DefinitionTypeField = Schema.String.check(
  Schema.makeFilter(
    isDefinitionTypeName,
    { expected: 'a type: 3 to 32 lowercase letters, digits and hyphens, starting with a letter' },
    true,
  ),
);

interface Served {
  readonly refusals: ReadonlyMap<string, string>;
  readonly expected: string;
}

function servedTypeField(types: readonly string[], { refusals, expected }: Served): typeof DefinitionTypeField {
  return DefinitionTypeField.check(
    Schema.makeFilter((type: string) => types.includes(type) || (refusals.get(type) ?? false), {
      expected: `${expected}: ${alternatives(types)}`,
    }),
  );
}

export interface KnownCapabilities {
  readonly field: typeof DefinitionTypeField;
  readonly types: readonly string[];
  readonly usingTypes: readonly string[];
  readonly typesInWords: string;
  readonly reachesOutside: boolean;
  readonly publish: <Operation extends PublishedOperation>(operation: Operation, meaning?: string) => Operation;
  readonly capabilityOfType: (name: string) => Effect.Effect<DefinitionKind, NotFound>;
}

function requireSomeCapability(names: readonly string[]): void {
  if (names.length === 0) {
    throw new Error('The definition operations need at least one capability');
  }
}

function requireDistinctNames(names: readonly string[]): void {
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new Error(`The type ${repeated} is used more than once`);
  }
}

const typeMeaning = "The definition's type";

function withTypeField(
  { schema, definitions }: JsonSchemaDocument,
  capabilities: readonly Capability[],
  meaning: string,
): JsonSchemaDocument {
  const typeProperty = {
    type: 'string',
    enum: capabilities.map(({ type }) => type),
    description: meaning,
  };
  return {
    schema: { ...schema, properties: Object.assign({}, schema['properties'], { type: typeProperty }) },
    definitions,
  };
}

function knownOf(capabilities: readonly DefinitionKind[], served: Served): KnownCapabilities {
  const names = capabilities.map(({ type }) => type);
  requireSomeCapability(names);
  requireDistinctNames(names);
  const byName = new Map(capabilities.map((capability) => [capability.type, capability]));
  return {
    field: servedTypeField(names, served),
    types: names,
    usingTypes: capabilities.filter(({ presents }) => presents === undefined).map(({ type }) => type),
    typesInWords: alternatives(names),
    reachesOutside: capabilities.some(({ reachesOutside }) => reachesOutside),
    publish: (operation, meaning = typeMeaning) => ({
      ...operation,
      registration: {
        ...operation.registration,
        input: withTypeField(operation.registration.input, capabilities, meaning),
      },
    }),
    capabilityOfType: (name) => {
      const capability = byName.get(name);
      return capability === undefined
        ? Effect.fail(new NotFound({ detail: `There is no definition type ${name}` }))
        : Effect.succeed(capability);
    },
  };
}

export function knownCapabilities(capabilities: readonly DefinitionKind[]): KnownCapabilities {
  return knownOf(capabilities, { refusals: new Map(), expected: 'a type of definition this server keeps' });
}

export function runningOf(capabilities: readonly DefinitionKind[]): readonly DefinitionKind[] {
  return capabilities.filter(({ neverRuns }) => neverRuns === undefined);
}

export function knownRunningCapabilities(capabilities: readonly DefinitionKind[]): KnownCapabilities {
  const refusals = new Map(
    capabilities.flatMap(({ type, neverRuns }) => (neverRuns === undefined ? [] : [[type, neverRuns] as const])),
  );
  return knownOf(runningOf(capabilities), { refusals, expected: 'a type this server runs' });
}
