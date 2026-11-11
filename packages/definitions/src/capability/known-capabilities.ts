import { DirectoryListing, NotFound, type JsonSchemaDocument, type RouteRegistration } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { isDefinitionTypeName, type Capability } from './capability.ts';
import { inDefinitionTypeOrder, typeByEachPartsJob } from './function-terminology.ts';

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

function servedTypeField(types: readonly string[], expected: string): typeof DefinitionTypeField {
  return DefinitionTypeField.check(
    Schema.makeFilter((type: string) => types.includes(type), { expected: `${expected}: ${alternatives(types)}` }),
  );
}

export interface KnownCapabilities {
  readonly field: typeof DefinitionTypeField;
  readonly types: readonly string[];
  readonly byEachPartsJob: string | undefined;
  readonly reachesOutside: boolean;
  readonly publish: <Operation extends PublishedOperation>(operation: Operation, meaning?: string) => Operation;
  readonly capabilityOfType: (name: string) => Effect.Effect<Capability, NotFound>;
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

function knownOf(given: readonly Capability[], expected: string): KnownCapabilities {
  const capabilities = inDefinitionTypeOrder(given);
  const names = capabilities.map(({ type }) => type);
  requireSomeCapability(names);
  requireDistinctNames(names);
  const byName = new Map(capabilities.map((capability) => [capability.type, capability]));
  return {
    field: servedTypeField(names, expected),
    types: names,
    byEachPartsJob: typeByEachPartsJob(names),
    reachesOutside: capabilities.some(({ reachesOutside }) => reachesOutside),
    publish: (operation, meaning = typeMeaning) => ({
      ...operation,
      registration: {
        ...operation.registration,
        input: withTypeField(operation.registration.input, capabilities, meaning),
      },
    }),
    capabilityOfType: Effect.fnUntraced(function* (name: string) {
      const capability = byName.get(name);
      if (capability === undefined) {
        return yield* Effect.fail(new NotFound({ detail: `There is no definition type ${name}` }));
      }
      if ((yield* DirectoryListing) && capability.outsideTheDirectoryListing === true) {
        return yield* Effect.fail(new NotFound({ detail: `The directory listing keeps no definition type ${name}` }));
      }
      return capability;
    }),
  };
}

export function knownCapabilities(capabilities: readonly Capability[]): KnownCapabilities {
  return knownOf(capabilities, 'a type of definition this server keeps');
}

export function knownRunningCapabilities(capabilities: readonly Capability[]): KnownCapabilities {
  return knownOf(capabilities, 'a type this server runs');
}
