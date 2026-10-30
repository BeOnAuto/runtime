import { JsonPointer, Schema } from 'effect';

import { byName, isJsonList, isJsonObject, referencesIn } from './discovery-document.ts';
import type { Found, JsonFields } from './openapi-operations.ts';

type Json = Schema.Json;

type Keyword = readonly [string, Json];

interface SchemaSource {
  readonly references: string;
  readonly schemas: JsonFields;
}

export interface Source extends SchemaSource {
  readonly description: JsonFields;
}

const componentSchemas = '#/components/schemas/';

const swaggerDefinitions = '#/definitions/';

const childSchemas: ReadonlySet<string> = new Set(['items', 'additionalProperties', 'allOf', 'anyOf', 'oneOf', 'not']);

const methods: ReadonlySet<string> = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const localReference = '#/';

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

function fieldOf(value: Json | undefined, key: string): Json | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

export function fieldsAt(value: Json | undefined, key: string): JsonFields {
  const found = fieldOf(value, key);
  return isJsonObject(found) ? found : {};
}

export function textAt(value: Json | undefined, key: string): string | undefined {
  const found = fieldOf(value, key);
  return typeof found === 'string' ? found : undefined;
}

export function sourceOf(read: unknown): Source {
  const json = decodeJson(read);
  const description = isJsonObject(json) ? json : {};
  return description['swagger'] === undefined
    ? { description, references: componentSchemas, schemas: fieldsAt(description['components'], 'schemas') }
    : { description, references: swaggerDefinitions, schemas: fieldsAt(description, 'definitions') };
}

export function resolved(description: JsonFields, value: Json): JsonFields {
  const reference = textAt(value, '$ref');
  const target =
    reference?.startsWith(localReference) === true
      ? reference
          .slice(localReference.length)
          .split('/')
          .reduce<Json | undefined>((node, token) => fieldOf(node, JsonPointer.unescapeToken(token)), description)
      : value;
  return isJsonObject(target) ? target : {};
}

export function operationsIn({ description }: Source): readonly Found[] {
  const paths = fieldsAt(description, 'paths');
  return Object.keys(paths).flatMap((path) =>
    Object.entries(fieldsAt(paths, path)).flatMap(([method, operation]: Keyword): readonly Found[] =>
      methods.has(method) && isJsonObject(operation) ? [{ path, method, operation, held: new Map() }] : [],
    ),
  );
}

function convertedProperties(properties: JsonFields, references: string): JsonFields {
  return Object.fromEntries(
    Object.entries(properties).map(([name, each]: Keyword) => [name, convertedSchema(each, references)]),
  );
}

function convertedKeyword([keyword, value]: Keyword, references: string): readonly Keyword[] {
  if (keyword === 'nullable') {
    return [];
  }
  if (keyword === 'example') {
    return [['examples', [value]]];
  }
  if (keyword === '$ref' && typeof value === 'string') {
    return [['$ref', value.replace(references, componentSchemas)]];
  }
  if (keyword === 'properties' && isJsonObject(value)) {
    return [['properties', convertedProperties(value, references)]];
  }
  return [[keyword, childSchemas.has(keyword) ? convertedSchema(value, references) : value]];
}

export function convertedSchema(schema: Json, references: string): Json {
  if (isJsonList(schema)) {
    return schema.map((each) => convertedSchema(each, references));
  }
  if (!isJsonObject(schema)) {
    return schema;
  }
  const converted = Object.fromEntries(
    Object.entries(schema).flatMap((keyword: Keyword) => convertedKeyword(keyword, references)),
  );
  const type = converted['type'];
  return schema['nullable'] === true && typeof type === 'string' ? { ...converted, type: [type, 'null'] } : converted;
}

function schemaNamesIn(value: Json): readonly string[] {
  return referencesIn(value)
    .filter((reference) => reference.startsWith(componentSchemas))
    .map((reference) => JsonPointer.unescapeToken(reference.slice(componentSchemas.length)));
}

export function reachedSchemasOf(
  operations: readonly Json[],
  { schemas, references }: SchemaSource,
): ReadonlyMap<string, Json> {
  const reached = new Map<string, Json>();
  const pending = operations.flatMap((operation) => schemaNamesIn(operation));
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const written = schemas[name];
    if (written === undefined) {
      throw new Error(`The description has no schema ${name}, which an operation the document keeps refers to`);
    }
    if (!reached.has(name)) {
      const converted = convertedSchema(written, references);
      reached.set(name, converted);
      pending.push(...schemaNamesIn(converted));
    }
  }
  return reached;
}

function joinedSchemas(
  joined: ReadonlyMap<string, Json>,
  reached: ReadonlyMap<string, Json>,
): ReadonlyMap<string, Json> {
  for (const [name, schema] of reached) {
    const held = joined.get(name);
    if (held !== undefined && JSON.stringify(held) !== JSON.stringify(schema)) {
      throw new Error(`Two descriptions hold a schema ${name}, and the two differ`);
    }
  }
  return new Map([...joined, ...reached]);
}

export function schemasByName(reachedOfEach: readonly ReadonlyMap<string, Json>[]): JsonFields {
  const joined = reachedOfEach.reduce<ReadonlyMap<string, Json>>(
    (held, reached) => joinedSchemas(held, reached),
    new Map(),
  );
  return Object.fromEntries([...joined].toSorted(byName));
}
