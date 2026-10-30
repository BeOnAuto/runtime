import { NotFound, alternatives, articled, type JsonSchemaDocument, type RouteRegistration } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { isDefinitionTypeName, type Capability } from './capability.ts';

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

function servedTypeField(types: readonly string[]): typeof DefinitionTypeField {
  return DefinitionTypeField.check(
    Schema.makeFilter((type: string) => types.includes(type), {
      expected: `a type this server runs: ${alternatives(types)}`,
    }),
  );
}

export interface KnownCapabilities {
  readonly field: typeof DefinitionTypeField;
  readonly types: readonly string[];
  readonly typesWithNouns: string;
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

export function knownCapabilities(capabilities: readonly Capability[]): KnownCapabilities {
  const names = capabilities.map(({ type }) => type);
  requireSomeCapability(names);
  requireDistinctNames(names);
  const byName = new Map(capabilities.map((capability) => [capability.type, capability]));
  return {
    field: servedTypeField(names),
    types: names,
    typesWithNouns: capabilities.map(({ type, noun }) => `${type}, ${articled(noun.one)}`).join('; '),
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
