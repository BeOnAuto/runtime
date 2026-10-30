import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { JsonSchemaDocument } from '@on.auto/operations';
import { Predicate, Schema } from 'effect';

export type JsonSchema = Record<string, unknown>;

export const jsonSchemaDialect = 'https://json-schema.org/draft/2020-12/schema';

const definitionReference = /^#\/\$defs\/(.+)$/u;

function withoutReference(schema: Readonly<Record<string, unknown>>): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([keyword]: readonly [string, unknown]) => keyword !== '$ref'),
  );
}

export function inlinedRootOf({ schema, definitions }: JsonSchemaDocument): JsonSchema {
  const reference = schema['$ref'];
  const name = typeof reference === 'string' ? definitionReference.exec(reference)?.[1] : undefined;
  const definition = name === undefined ? undefined : definitions[name];
  return definition === undefined ? { ...schema } : { ...definition, ...withoutReference(schema) };
}

const DefinitionsSchema = Schema.Struct({
  $defs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const definitionsOf = Schema.decodeUnknownSync(DefinitionsSchema);

function referencesIn(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => referencesIn(item));
  }
  if (!Predicate.isObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([keyword, member]: readonly [string, unknown]) =>
    keyword === '$ref' && typeof member === 'string'
      ? (definitionReference.exec(member)?.slice(1) ?? [])
      : referencesIn(member),
  );
}

function reachable(
  names: readonly string[],
  definitions: Readonly<Record<string, unknown>>,
  found: ReadonlySet<string>,
): ReadonlySet<string> {
  const unseen = names.filter((name) => !found.has(name));
  return unseen.length === 0
    ? found
    : reachable(
        unseen.flatMap((name) => referencesIn(definitions[name])),
        definitions,
        new Set([...found, ...unseen]),
      );
}

export function withoutUnreferencedDefinitions(schema: Readonly<JsonSchema>): JsonSchema {
  const { $defs: definitions = {} } = definitionsOf(schema);
  const rest = Object.fromEntries(
    Object.entries(schema).filter(([keyword]: readonly [string, unknown]) => keyword !== '$defs'),
  );
  const used = reachable(referencesIn(rest), definitions, new Set());
  const kept = Object.entries(definitions).filter(([name]: readonly [string, unknown]) => used.has(name));
  return kept.length === 0 ? rest : { ...rest, $defs: Object.fromEntries(kept) };
}

export function selfContainedSchemaOf(document: JsonSchemaDocument): JsonSchema {
  const root = { $schema: jsonSchemaDialect, ...inlinedRootOf(document) };
  return Object.keys(document.definitions).length === 0 ? root : { ...root, $defs: { ...document.definitions } };
}

export function advertisedSchema(jsonSchema: Readonly<JsonSchema>): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'on.auto',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  };
}
