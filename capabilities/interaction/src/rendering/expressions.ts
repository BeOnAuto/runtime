import { pointerTo } from './json-pointers.ts';
import { entriesOf, isList, isRecord, itemsOf } from './written-values.ts';

export interface Expression {
  readonly pointer: string;
  readonly key: string;
  readonly value: unknown;
}

function expressionsInEntries(entries: readonly (readonly [string | number, unknown])[], pointer: string) {
  return entries.flatMap(([key, value]) => {
    const here = pointerTo(pointer, key);
    const own = typeof key === 'string' && key.startsWith('$') ? [{ pointer: here, key, value }] : [];
    return [...own, ...expressionsIn(value, here)];
  });
}

export function expressionsIn(value: unknown, pointer: string): readonly Expression[] {
  if (isList(value)) {
    return expressionsInEntries(itemsOf(value), pointer);
  }
  return isRecord(value) ? expressionsInEntries(entriesOf(value), pointer) : [];
}
