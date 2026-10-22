import type { Schema } from 'effect';

export type JsonSchema = Schema.JsonObject;

export interface SchemaReading {
  readonly root: JsonSchema;
  readonly depth: number;
  readonly expanded: boolean;
}

type Entry = readonly [string, Schema.Json];

export const mostSchemaDepth = 8;

const anything: JsonSchema = {};

export function isJsonSchema(value: Schema.Json | undefined): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonList(value: Schema.Json | undefined): value is Schema.JsonArray {
  return Array.isArray(value);
}

function schemaOf(value: Schema.Json | undefined): JsonSchema {
  return isJsonSchema(value) ? value : anything;
}

export function textOf(schema: JsonSchema, keyword: string): string | undefined {
  const value = schema[keyword];
  return typeof value === 'string' ? value : undefined;
}

export function valueText(value: Schema.Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function numberOf(schema: JsonSchema, keyword: string): number | undefined {
  const value = schema[keyword];
  return typeof value === 'number' ? value : undefined;
}

export function listOf(schema: JsonSchema, keyword: string): Schema.JsonArray {
  const value = schema[keyword];
  return isJsonList(value) ? value : [];
}

function unescapedSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function pointedSchema(root: JsonSchema, reference: string): JsonSchema {
  if (!reference.startsWith('#')) {
    return anything;
  }
  let schema: Schema.Json | undefined = root;
  for (const segment of reference.slice(1).split('/').slice(1)) {
    schema = isJsonSchema(schema) ? schema[unescapedSegment(segment)] : undefined;
  }
  return schemaOf(schema);
}

export function deeper(reading: SchemaReading, expanded = reading.expanded): SchemaReading {
  return { ...reading, depth: reading.depth + 1, expanded };
}

interface ReadSchema {
  readonly schema: JsonSchema;
  readonly reading: SchemaReading;
}

export function resolvedSchema(schema: JsonSchema, reading: SchemaReading): ReadSchema {
  const reference = textOf(schema, '$ref');
  if (reference === undefined || reading.depth > mostSchemaDepth) {
    return { schema, reading };
  }
  const own = Object.entries(schema).filter((entry: Entry) => entry[0] !== '$ref');
  const referenced = resolvedSchema(pointedSchema(reading.root, reference), deeper(reading));
  return { schema: Object.fromEntries([...Object.entries(referenced.schema), ...own]), reading: referenced.reading };
}

export function typesOf(schema: JsonSchema): readonly string[] {
  const type = schema['type'];
  if (typeof type === 'string') {
    return [type];
  }
  return isJsonList(type) ? type.filter((each) => typeof each === 'string') : [];
}

export function propertiesOf(schema: JsonSchema): readonly (readonly [string, JsonSchema])[] {
  const properties = schema['properties'];
  return isJsonSchema(properties)
    ? Object.entries(properties).map(([name, value]: Entry) => [name, schemaOf(value)] as const)
    : [];
}

export function requiredOf(schema: JsonSchema): ReadonlySet<string> {
  return new Set(listOf(schema, 'required').filter((name) => typeof name === 'string'));
}

export interface PlaceStep {
  readonly token: string;
  readonly within: readonly JsonSchema[];
}

export interface SchemaPlace {
  readonly steps: readonly PlaceStep[];
  readonly schemas: readonly JsonSchema[];
}

const combinators = ['allOf', 'anyOf', 'oneOf'];

const listIndex = /^(?:0|[1-9]\d*)$/u;

function appliedSchemas(schema: JsonSchema, reading: SchemaReading): readonly JsonSchema[] {
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  return [
    read,
    ...combinators
      .flatMap((keyword) => listOf(read, keyword))
      .filter((member) => isJsonSchema(member))
      .flatMap((member) => appliedSchemas(member, deeper(within))),
  ];
}

function fieldSchema(schema: JsonSchema, token: string): Schema.Json | undefined {
  const properties = schema['properties'];
  return isJsonSchema(properties) ? properties[token] : undefined;
}

function itemSchema(schema: JsonSchema, token: string): Schema.Json | undefined {
  if (!listIndex.test(token)) {
    return undefined;
  }
  const prefix = listOf(schema, 'prefixItems');
  const position = Number(token);
  return position < prefix.length ? prefix[position] : schema['items'];
}

function childSchemas(schema: JsonSchema, token: string): readonly JsonSchema[] {
  return [fieldSchema(schema, token), itemSchema(schema, token), schema['additionalProperties']].filter((child) =>
    isJsonSchema(child),
  );
}

export function placeAt(root: JsonSchema, tokens: readonly string[]): SchemaPlace {
  const reading: SchemaReading = { root, depth: 0, expanded: false };
  return tokens.reduce<SchemaPlace>(
    ({ steps, schemas }, token) => ({
      steps: [...steps, { token, within: schemas }],
      schemas: schemas
        .flatMap((schema) => childSchemas(schema, token))
        .flatMap((child) => appliedSchemas(child, reading)),
    }),
    { steps: [], schemas: appliedSchemas(root, reading) },
  );
}

export function namesAt(root: JsonSchema, tokens: readonly string[]): readonly JsonSchema[] {
  const reading: SchemaReading = { root, depth: 0, expanded: false };
  return placeAt(root, tokens)
    .schemas.map((schema) => schema['propertyNames'])
    .filter((names) => isJsonSchema(names))
    .flatMap((names) => appliedSchemas(names, reading));
}

export function isItemOf({ token, within }: PlaceStep): boolean {
  return (
    listIndex.test(token) &&
    within.some((schema) => isJsonSchema(schema['items']) || listOf(schema, 'prefixItems').length > 0)
  );
}
