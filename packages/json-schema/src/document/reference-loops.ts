import { JsonPointer, Predicate, type Schema } from 'effect';

import type { SchemaIssue } from './json-bounds.ts';

const definitionKeywords = ['$defs', 'definitions'];

const sameValueKeywords = ['allOf', 'anyOf', 'oneOf'];

const loopDetail =
  'This definition leads into a loop of $ref, allOf, anyOf or oneOf with no property or item in between, so no value can be checked against it';

function isObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function referencesOf(schema: Schema.Json): readonly string[] {
  if (!isObject(schema)) {
    return [];
  }
  const reference = schema['$ref'];
  const own = typeof reference === 'string' ? [reference] : [];
  const combined = sameValueKeywords.flatMap((keyword) => {
    const entries = schema[keyword];
    return Array.isArray(entries) ? entries.flatMap((entry: Schema.Json) => referencesOf(entry)) : [];
  });
  return [...own, ...combined];
}

function definitionsOf(document: Schema.JsonObject): ReadonlyMap<string, readonly string[]> {
  return new Map(
    definitionKeywords.flatMap((keyword) => {
      const definitions = document[keyword];
      return isObject(definitions)
        ? Object.entries(definitions).map(([name, schema]: readonly [string, Schema.Json]) => [
            `/${keyword}/${JsonPointer.escapeToken(name)}`,
            referencesOf(schema).map((reference) => reference.replace(/^#/u, '')),
          ])
        : [];
    }),
  );
}

function leadingIntoLoops(references: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const unresolved = new Map<string, number>();
  const referrers = new Map<string, string[]>();
  for (const [pointer, targets] of references) {
    const defined = targets.filter((target) => references.has(target));
    unresolved.set(pointer, defined.length);
    for (const target of defined) {
      referrers.set(target, [...(referrers.get(target) ?? []), pointer]);
    }
  }
  const settled = [...unresolved.keys()].filter((pointer) => unresolved.get(pointer) === 0);
  for (let next = settled.pop(); next !== undefined; next = settled.pop()) {
    for (const referrer of referrers.get(next) ?? []) {
      const remaining = Number(unresolved.get(referrer)) - 1;
      unresolved.set(referrer, remaining);
      if (remaining === 0) {
        settled.push(referrer);
      }
    }
  }
  return [...unresolved.keys()].filter((pointer) => Number(unresolved.get(pointer)) > 0);
}

export function referenceLoopIssues(document: Schema.JsonObject): readonly SchemaIssue[] {
  return leadingIntoLoops(definitionsOf(document)).map((pointer) => ({ pointer, detail: loopDetail }));
}
