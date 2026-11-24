import { Schema } from 'effect';

import { hasKey, isList, isRecord } from './written-values.ts';

type Subschema =
  | { readonly kind: 'schema'; readonly schema: Schema.JsonObject }
  | { readonly kind: 'open' }
  | { readonly kind: 'none' };

const isSchema = Schema.is(Schema.JsonObject);

const open: Subschema = { kind: 'open' };

const none: Subschema = { kind: 'none' };

const combining = ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'patternProperties', 'prefixItems'];

function holding(schema: unknown): Subschema {
  return isSchema(schema) ? { kind: 'schema', schema } : open;
}

function memberOf(schema: Readonly<Record<string, unknown>>, name: string): Subschema {
  const { properties, additionalProperties } = schema;
  if (isRecord(properties) && hasKey(properties, name)) {
    return holding(properties[name]);
  }
  if (additionalProperties === true || isRecord(additionalProperties)) {
    return holding(additionalProperties);
  }
  return isRecord(properties) || additionalProperties === false ? none : open;
}

function itemOf(schema: Readonly<Record<string, unknown>>): Subschema {
  const { items } = schema;
  return isSchema(items) ? { kind: 'schema', schema: items } : open;
}

function stepInto(schema: Readonly<Record<string, unknown>>, segment: string): Subschema {
  if (combining.some((keyword) => hasKey(schema, keyword))) {
    return open;
  }
  return schema['type'] === 'array' || isRecord(schema['items']) ? itemOf(schema) : memberOf(schema, segment);
}

export function subschemaAt(schema: Schema.JsonObject, segments: readonly string[]): Subschema {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return { kind: 'schema', schema };
  }
  const inside = stepInto(schema, head);
  return inside.kind === 'schema' ? subschemaAt(inside.schema, rest) : inside;
}

export function segmentsOf(place: string): readonly string[] {
  return place
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function requiredOf(schema: Readonly<Record<string, unknown>>): readonly string[] {
  const { required } = schema;
  return isList(required) ? required.filter((name): name is string => typeof name === 'string') : [];
}

function coversUnder(places: readonly string[], path: string): boolean {
  return places.some((place) => place === path || place.startsWith(`${path}/`));
}

function missingUnder(schema: Schema.JsonObject, prefix: string, places: readonly string[]): readonly string[] {
  return requiredOf(schema).flatMap((name) => {
    const path = `${prefix}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (!coversUnder(places, path)) {
      return [path];
    }
    const inside = memberOf(schema, name);
    return inside.kind === 'schema' && !places.includes(path) ? missingUnder(inside.schema, path, places) : [];
  });
}

export function placesNeverSet(schema: Schema.JsonObject, places: readonly string[]): readonly string[] {
  return missingUnder(schema, '', places);
}

export function valueAt(root: Schema.Json, place: string): Schema.Json {
  return segmentsOf(place).reduce<Schema.Json>(
    (inside, segment) => (isSchema(inside) ? (inside[segment] ?? null) : null),
    root,
  );
}

export function isDecided(answered: Schema.Json, place: string): boolean {
  const found = valueAt(answered, place);
  return isSchema(found) && hasKey(found, 'by');
}

export function decidedBy(answered: Schema.Json, place: string): string | undefined {
  const found = valueAt(answered, place);
  return isSchema(found) && typeof found['by'] === 'string' ? found['by'] : undefined;
}
