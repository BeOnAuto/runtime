import type { Schema } from 'effect';

export type JsonChild = readonly [string, Schema.Json];

export type JsonParent = Schema.JsonArray | Schema.JsonObject;

export function isJsonArray(value: JsonParent): value is Schema.JsonArray {
  return Array.isArray(value);
}

export function isJsonParent(value: Schema.Json): value is JsonParent {
  return value !== null && typeof value === 'object';
}

export function childrenOf(value: JsonParent): readonly JsonChild[] {
  return isJsonArray(value) ? value.map((item, index): JsonChild => [String(index), item]) : Object.entries(value);
}
