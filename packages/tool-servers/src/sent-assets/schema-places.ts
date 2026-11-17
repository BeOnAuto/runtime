import { JsonPointer, Predicate, type Schema } from 'effect';

export interface PlaceDeclared {
  readonly base64: boolean;
  readonly types: ReadonlySet<string> | 'any';
}

type JsonSchema = Readonly<Record<string, unknown>>;

const compositions = ['allOf', 'anyOf', 'oneOf'] as const;

const mostSchemasAtAPlace = 256;

const indexToken = /^(?:0|[1-9]\d*)$/u;

function isSchema(value: unknown): value is JsonSchema {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function schemasIn(value: unknown): readonly JsonSchema[] {
  return Array.isArray(value) ? value.filter((item) => isSchema(item)) : [];
}

function referenced(root: JsonSchema, reference: unknown): JsonSchema | undefined {
  if (typeof reference !== 'string' || !reference.startsWith('#')) {
    return undefined;
  }
  const tokens = reference.slice(1).split('/').slice(1);
  const found = tokens.reduce<unknown>(
    (schema, token) => (isSchema(schema) ? schema[JsonPointer.unescapeToken(token)] : undefined),
    root,
  );
  return isSchema(found) ? found : undefined;
}

function partsOf(root: JsonSchema, schema: JsonSchema): readonly JsonSchema[] {
  const reference = referenced(root, schema['$ref']);
  return [
    ...compositions.flatMap((keyword) => schemasIn(schema[keyword])),
    ...(reference === undefined ? [] : [reference]),
  ];
}

function expanded(root: JsonSchema, schemas: readonly JsonSchema[]): readonly JsonSchema[] {
  const seen = new Set<JsonSchema>();
  const pending = [...schemas];
  for (
    let schema = pending.shift();
    schema !== undefined && seen.size < mostSchemasAtAPlace;
    schema = pending.shift()
  ) {
    if (!seen.has(schema)) {
      seen.add(schema);
      pending.push(...partsOf(root, schema));
    }
  }
  return [...seen];
}

function itemAt(schema: JsonSchema, token: string): readonly JsonSchema[] {
  if (!indexToken.test(token)) {
    return [];
  }
  const index = Number(token);
  const prefix = schemasIn(schema['prefixItems']);
  const tuple = schemasIn(schema['items']);
  const positional = prefix.length > 0 ? prefix : tuple;
  const item = positional[index];
  if (item !== undefined) {
    return [item];
  }
  const rest = Array.isArray(schema['items']) ? schema['additionalItems'] : schema['items'];
  return isSchema(rest) ? [rest] : [];
}

function memberAt(schema: JsonSchema, token: string): readonly JsonSchema[] {
  const properties = schema['properties'];
  const property = isSchema(properties) && Object.hasOwn(properties, token) ? properties[token] : undefined;
  if (isSchema(property)) {
    return [property];
  }
  const others = schema['additionalProperties'];
  return isSchema(others) ? [others] : [];
}

function childrenAt(schema: JsonSchema, token: string): readonly JsonSchema[] {
  return [...memberAt(schema, token), ...itemAt(schema, token)];
}

function typesOf(schema: JsonSchema): readonly string[] | undefined {
  const type = schema['type'];
  if (typeof type === 'string') {
    return [type];
  }
  return Array.isArray(type) ? type.filter((each) => typeof each === 'string') : undefined;
}

function isBase64(schema: JsonSchema): boolean {
  const encoding = schema['contentEncoding'];
  return (typeof encoding === 'string' && encoding.toLowerCase() === 'base64') || schema['format'] === 'byte';
}

function declaredBy(root: JsonSchema, schemas: readonly JsonSchema[]): PlaceDeclared {
  const all = expanded(root, schemas);
  const types = all.flatMap((schema) => typesOf(schema) ?? []);
  return { base64: all.some((schema) => isBase64(schema)), types: types.length === 0 ? 'any' : new Set(types) };
}

export function declaredAt(inputSchema: Schema.JsonObject, pointer: string): PlaceDeclared {
  const tokens = pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
  const atThePlace = tokens.reduce<readonly JsonSchema[]>(
    (schemas, token) => expanded(inputSchema, schemas).flatMap((schema) => childrenAt(schema, token)),
    [inputSchema],
  );
  return declaredBy(inputSchema, atThePlace);
}
