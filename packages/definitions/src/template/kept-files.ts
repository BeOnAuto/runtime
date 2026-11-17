import { assetsIn, isAssetShaped } from '@on.auto/operations';
import { Predicate, type Schema } from 'effect';

export class KeptFileAsText extends Error {
  constructor() {
    super('A kept file has no text to write');
  }
}

export function refusedAsText(): never {
  throw new KeptFileAsText();
}

export function isAGuardedKeptFile(value: unknown): boolean {
  return Predicate.isObject(value) && Object.hasOwn(value, Symbol.toPrimitive);
}

function isJsonObject(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function guardedIn(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json) => guardedIn(item));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const members = Object.entries(value);
  return isAssetShaped(value)
    ? Object.defineProperty(Object.fromEntries(members), Symbol.toPrimitive, { value: refusedAsText })
    : Object.fromEntries(members.map(([name, member]: readonly [string, Schema.Json]) => [name, guardedIn(member)]));
}

export function withKeptFilesGuarded(
  variables: Readonly<Record<string, Schema.Json>>,
): Readonly<Record<string, Schema.Json>> {
  return assetsIn(variables).length === 0
    ? variables
    : Object.fromEntries(
        Object.entries(variables).map(([name, value]: readonly [string, Schema.Json]) => [name, guardedIn(value)]),
      );
}
