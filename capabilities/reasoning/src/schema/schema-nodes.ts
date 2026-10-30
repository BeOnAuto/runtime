import { Predicate, type Schema } from 'effect';

export type Path = readonly (string | number)[];

export interface SchemaNode {
  readonly schema: Schema.JsonObject;
  readonly path: Path;
}

const singleSchemas = ['items', 'additionalProperties', 'propertyNames', 'not'];
const schemaLists = ['prefixItems', 'anyOf', 'oneOf', 'allOf'];
const schemaMaps = ['properties', '$defs', 'definitions'];

function isObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function isList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function nodeAt(value: Schema.Json | undefined, path: Path): readonly SchemaNode[] {
  return isObject(value) ? [{ schema: value, path }] : [];
}

function childrenOf({ schema, path }: SchemaNode): readonly SchemaNode[] {
  const single = singleSchemas.flatMap((keyword) => nodeAt(schema[keyword], [...path, keyword]));
  const listed = schemaLists.flatMap((keyword) => {
    const entries = schema[keyword];
    return isList(entries) ? entries.flatMap((entry, index) => nodeAt(entry, [...path, keyword, index])) : [];
  });
  const mapped = schemaMaps.flatMap((keyword) => {
    const entries = schema[keyword];
    return isObject(entries)
      ? Object.entries(entries).flatMap(([name, entry]: readonly [string, Schema.Json]) =>
          nodeAt(entry, [...path, keyword, name]),
        )
      : [];
  });
  return [...single, ...listed, ...mapped];
}

export function schemaNodes(root: Schema.JsonObject): readonly SchemaNode[] {
  const nodes: SchemaNode[] = [];
  const pending: SchemaNode[] = [{ schema: root, path: [] }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    nodes.push(next);
    pending.push(...childrenOf(next).toReversed());
  }
  return nodes;
}
