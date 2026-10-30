import type { Json, JsonObject } from '../dsl/json.ts';
import { pointerTo } from '../dsl/tasks.ts';
import { isRecord, type PatchOperation } from '../run-log/state-patch.ts';

type Fields = Readonly<Record<string, unknown>>;

function objectOf(fields: Fields): JsonObject {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, item]: readonly [string, unknown]) => item !== undefined)
      .map(([key, item]: readonly [string, unknown]) => [key, jsonOf(item)]),
  );
}

function jsonOf(value: unknown): Json {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonOf(item));
  }
  return isRecord(value) ? objectOf(value) : null;
}

function diffFields(before: Fields, after: Fields, path: string): readonly PatchOperation[] {
  const removed = Object.keys(before)
    .filter((key) => !Object.hasOwn(after, key))
    .map((key): PatchOperation => ({ op: 'remove', path: pointerTo(path, key) }));
  const changed = Object.entries(after).flatMap(([key, item]: readonly [string, unknown]): readonly PatchOperation[] =>
    Object.hasOwn(before, key)
      ? diffInto(before[key], item, pointerTo(path, key))
      : [{ op: 'add', path: pointerTo(path, key), value: jsonOf(item) }],
  );
  return [...removed, ...changed];
}

function diffInto(before: unknown, after: unknown, path: string): readonly PatchOperation[] {
  if (before === after) {
    return [];
  }
  if (isRecord(before) && isRecord(after)) {
    return diffFields(before, after, path);
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return diffLists(before, after, path);
  }
  return [{ op: 'replace', path, value: jsonOf(after) }];
}

function diffLists(before: readonly unknown[], after: readonly unknown[], path: string): readonly PatchOperation[] {
  if (before.length > after.length) {
    return [{ op: 'replace', path, value: jsonOf(after) }];
  }
  const changed = before.flatMap((item: unknown, index) => diffInto(item, after[index], pointerTo(path, index)));
  const appended = after
    .slice(before.length)
    .map((item: unknown): PatchOperation => ({ op: 'add', path: pointerTo(path, '-'), value: jsonOf(item) }));
  return [...changed, ...appended];
}

export function patchBetween(before: object, after: object): readonly PatchOperation[] {
  return diffInto(before, after, '');
}
