import { JsonPointer, type Schema } from 'effect';

interface PlacedText {
  readonly pointer: string;
  readonly text: string;
}

type JsonChild = readonly [string, Schema.Json];

function childrenOf(value: Schema.Json): readonly JsonChild[] {
  if (Array.isArray(value)) {
    return value.map((item, index): JsonChild => [String(index), item]);
  }
  return value !== null && typeof value === 'object' ? Object.entries(value) : [];
}

export function textsIn(value: Schema.Json, pointer: string): readonly PlacedText[] {
  if (typeof value === 'string') {
    return [{ pointer, text: value }];
  }
  return childrenOf(value).flatMap(([key, item]) => textsIn(item, `${pointer}/${JsonPointer.escapeToken(key)}`));
}

export function pathOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}
