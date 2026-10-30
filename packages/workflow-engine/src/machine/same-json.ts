import type { Schema } from 'effect';

function isList(value: Schema.Json): value is Schema.JsonArray {
  return Array.isArray(value);
}

function canonical(value: Schema.Json): Schema.Json {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isList(value)) {
    return value.map((item: Schema.Json) => canonical(item));
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([first]: readonly [string, Schema.Json], [second]: readonly [string, Schema.Json]) =>
        first < second ? -1 : 1,
      )
      .map(([key, item]: readonly [string, Schema.Json]) => [key, canonical(item)]),
  );
}

export function sameJson(first: Schema.Json, second: Schema.Json): boolean {
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}
