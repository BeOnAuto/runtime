import { JsonPointer, Predicate, type Schema } from 'effect';

import type { Path } from './schema-nodes.ts';

export type Definitions = ReadonlyMap<string, Schema.Json>;

const definitionKeywords = ['$defs', 'definitions'] as const;

export function isJsonObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value);
}

export function isJsonList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

export function joined(...parts: readonly Schema.JsonObject[]): Schema.JsonObject {
  return Object.fromEntries(parts.flatMap((part) => Object.entries(part)));
}

export function listOf(value: Schema.Json | undefined): readonly Schema.Json[] {
  return isJsonList(value) ? value : [];
}

export function entriesOf(value: Schema.Json | undefined): readonly (readonly [string, Schema.Json])[] {
  return isJsonObject(value) ? Object.entries(value) : [];
}

export function stringsOf(value: Schema.Json | undefined): readonly string[] {
  return listOf(value).filter((entry) => typeof entry === 'string');
}

export function typesOf(schema: Schema.JsonObject): readonly string[] {
  const type = schema['type'];
  return typeof type === 'string' ? [type] : stringsOf(type);
}

export function enumValuesOf(schema: Schema.JsonObject): readonly Schema.Json[] | undefined {
  const constant = schema['const'];
  if (constant !== undefined) {
    return [constant];
  }
  const values = schema['enum'];
  return isJsonList(values) ? values : undefined;
}

export function choicesOf(schema: Schema.JsonObject): readonly Schema.Json[] {
  return listOf(schema['anyOf'] ?? schema['oneOf']);
}

export function isMap(schema: Schema.JsonObject): boolean {
  return schema['properties'] === undefined && isJsonObject(schema['additionalProperties']);
}

export function isObjectRoot(root: Schema.JsonObject): boolean {
  return root['type'] === 'object' && isJsonObject(root['properties']);
}

export function definitionsOf(root: Schema.JsonObject): Definitions {
  return new Map(
    definitionKeywords.flatMap((keyword) =>
      entriesOf(root[keyword]).map(([name, schema]): readonly [string, Schema.Json] => [
        `#/${keyword}/${JsonPointer.escapeToken(name)}`,
        schema,
      ]),
    ),
  );
}

export function definitionPathOf(reference: string): Path {
  return reference
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

export function definedIn(definitions: Definitions, schema: Schema.Json | undefined): Schema.Json | undefined {
  const reference = isJsonObject(schema) ? schema['$ref'] : undefined;
  return typeof reference === 'string' ? definedIn(definitions, definitions.get(reference)) : schema;
}

function referencesIn(value: Schema.Json | undefined): readonly string[] {
  if (isJsonList(value)) {
    return value.flatMap((entry) => referencesIn(entry));
  }
  const reference = isJsonObject(value) ? value['$ref'] : undefined;
  const own = typeof reference === 'string' ? [reference] : [];
  return [...own, ...entriesOf(value).flatMap(([, entry]) => referencesIn(entry))];
}

function leadsBackTo(definitions: Definitions, start: string): boolean {
  const seen = new Set<string>();
  const pending = [...referencesIn(definitions.get(start))];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next === start) {
      return true;
    }
    if (!seen.has(next)) {
      seen.add(next);
      pending.push(...referencesIn(definitions.get(next)));
    }
  }
  return false;
}

export function recursiveReferences(definitions: Definitions): ReadonlySet<string> {
  return new Set([...definitions.keys()].filter((reference) => leadsBackTo(definitions, reference)));
}

function namesNull(schema: Schema.JsonObject): boolean {
  return typesOf(schema).includes('null') || (enumValuesOf(schema) ?? []).includes(null);
}

export function acceptsNull(definitions: Definitions, schema: Schema.Json | undefined): boolean {
  const node = definedIn(definitions, schema);
  if (!isJsonObject(node)) {
    return node === true;
  }
  return namesNull(node) || choicesOf(node).some((choice) => acceptsNull(definitions, choice));
}
