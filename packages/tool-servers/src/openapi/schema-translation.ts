import { JsonPointer, Predicate, type Schema } from 'effect';

import type { DocumentProblem, OpenApiVersion } from './api-document.ts';

export type SchemaObject = Readonly<Record<string, Schema.Json>>;

type Visit = (schema: SchemaObject, pointer: string) => SchemaObject;

interface Bound {
  readonly inclusive: string;
  readonly exclusive: string;
}

export interface ComponentReference {
  readonly name: string;
  readonly pointer: string;
}

export interface Standalone {
  readonly schema: Schema.Json;
  readonly references: readonly ComponentReference[];
  readonly problems: readonly DocumentProblem[];
}

const singleSchemas: ReadonlySet<string> = new Set([
  'items',
  'additionalProperties',
  'not',
  'propertyNames',
  'contains',
  'if',
  'then',
  'else',
  'unevaluatedItems',
  'unevaluatedProperties',
  'contentSchema',
]);

const schemaLists: ReadonlySet<string> = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

const schemaMaps: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);

const lower: Bound = { inclusive: 'minimum', exclusive: 'exclusiveMinimum' };

const upper: Bound = { inclusive: 'maximum', exclusive: 'exclusiveMaximum' };

const componentReference = /^#\/components\/schemas\/([^/]+)$/u;

const unfollowed =
  'A reference the runtime cannot follow: a schema of a tool server may refer only to #/components/schemas/<name> of its own document';

export function isSchemaObject(value: Schema.Json | undefined): value is SchemaObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function isSchemaList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function below(pointer: string, key: string | number): string {
  return `${pointer}/${JsonPointer.escapeToken(String(key))}`;
}

function mappedChild(key: string, value: Schema.Json, visit: Visit, pointer: string): Schema.Json {
  if (singleSchemas.has(key)) {
    return mappedSchema(value, visit, pointer);
  }
  if (schemaLists.has(key) && isSchemaList(value)) {
    return value.map((each, index) => mappedSchema(each, visit, below(pointer, index)));
  }
  return schemaMaps.has(key) && isSchemaObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([name, each]: readonly [string, Schema.Json]) => [
          name,
          mappedSchema(each, visit, below(pointer, name)),
        ]),
      )
    : value;
}

export function mappedSchema(schema: Schema.Json, visit: Visit, pointer = ''): Schema.Json {
  if (!isSchemaObject(schema)) {
    return schema;
  }
  const children = Object.fromEntries(
    Object.entries(schema).map(([key, value]: readonly [string, Schema.Json]) => [
      key,
      mappedChild(key, value, visit, below(pointer, key)),
    ]),
  );
  return visit(children, pointer);
}

function boundOf(limit: Schema.Json | undefined, exclusive: Schema.Json | undefined, bound: Bound): SchemaObject {
  if (exclusive === true && typeof limit === 'number') {
    return { [bound.exclusive]: limit };
  }
  const kept: SchemaObject = typeof exclusive === 'number' ? { [bound.exclusive]: exclusive } : {};
  return limit === undefined ? kept : { ...kept, [bound.inclusive]: limit };
}

function typesOf(type: Schema.Json | undefined): readonly Schema.Json[] | undefined {
  if (typeof type === 'string') {
    return [type];
  }
  return isSchemaList(type) ? type : undefined;
}

function withNull(schema: SchemaObject): SchemaObject {
  const { type, enum: values } = schema;
  const types = typesOf(type);
  if (types === undefined) {
    return schema;
  }
  return {
    ...schema,
    type: types.includes('null') ? types : [...types, 'null'],
    ...(isSchemaList(values) && !values.includes(null) ? { enum: [...values, null] } : {}),
  };
}

function examplesOf(example: Schema.Json | undefined, examples: Schema.Json | undefined): SchemaObject {
  if (example === undefined) {
    return examples === undefined ? {} : { examples };
  }
  return { examples: isSchemaList(examples) ? [...examples, example] : [example] };
}

function fromVersion30(schema: SchemaObject): SchemaObject {
  const { nullable, minimum, maximum, exclusiveMinimum, exclusiveMaximum, example, examples, ...rest } = schema;
  const bounded = {
    ...rest,
    ...boundOf(minimum, exclusiveMinimum, lower),
    ...boundOf(maximum, exclusiveMaximum, upper),
    ...examplesOf(example, examples),
  };
  return nullable === true ? withNull(bounded) : bounded;
}

export function translatedSchema(schema: Schema.Json, version: OpenApiVersion): Schema.Json {
  return version === '3.0' ? mappedSchema(schema, fromVersion30) : schema;
}

function componentNameOf(reference: string): string | undefined {
  const matched = componentReference.exec(reference);
  return matched === null ? undefined : JsonPointer.unescapeToken(String(matched[1]));
}

export function standaloneOf(schema: Schema.Json, at: string): Standalone {
  const references: ComponentReference[] = [];
  const problems: DocumentProblem[] = [];
  const rewritten = mappedSchema(schema, (object, pointer) => {
    const reference = object['$ref'];
    if (typeof reference !== 'string') {
      return object;
    }
    const name = componentNameOf(reference);
    const place = below(`${at}${pointer}`, '$ref');
    if (name === undefined) {
      problems.push({ pointer: place, detail: unfollowed });
      return object;
    }
    references.push({ name, pointer: place });
    return { ...object, $ref: `#/$defs/${JsonPointer.escapeToken(name)}` };
  });
  return { schema: rewritten, references, problems };
}
