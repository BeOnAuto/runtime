import type { Schema } from 'effect';

import { childrenOf, isJsonArray, isJsonParent, type JsonParent } from './json-children.ts';

const firstSurrogate = 0xd8_00;

const lastSurrogate = 0xdf_ff;

const lastOfOneCodeUnit = 0xff_ff;

const shortEscapes: ReadonlySet<number> = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x22, 0x5c]);

const firstPrintable = 0x20;

const firstOfTwoBytes = 0x80;

const firstOfThreeBytes = 0x8_00;

const quotes = 2;

function codeUnitBytes(code: number): number {
  if (shortEscapes.has(code)) {
    return 2;
  }
  if (code < firstPrintable || (code >= firstSurrogate && code <= lastSurrogate)) {
    return 6;
  }
  if (code < firstOfTwoBytes) {
    return 1;
  }
  return code < firstOfThreeBytes ? 2 : 3;
}

function textBytesAsJson(text: string): number {
  let bytes = quotes;
  let index = 0;
  while (index < text.length) {
    const code = Number(text.codePointAt(index));
    const paired = code > lastOfOneCodeUnit;
    bytes += paired ? 4 : codeUnitBytes(code);
    index += paired ? 2 : 1;
  }
  return bytes;
}

const nullBytes = 4;

function scalarBytesAsJson(value: Exclude<Schema.Json, JsonParent>): number {
  if (typeof value === 'string') {
    return textBytesAsJson(value);
  }
  return typeof value === 'number' && !Number.isFinite(value) ? nullBytes : String(value).length;
}

function parentBytesAsJson(value: JsonParent): number {
  const children = childrenOf(value);
  const separators = Math.max(0, children.length - 1);
  return children.reduce(
    (total, [key, child]) => total + bytesAsJsonOf(child) + (isJsonArray(value) ? 0 : textBytesAsJson(key) + 1),
    quotes + separators,
  );
}

export function bytesAsJsonOf(value: Schema.Json): number {
  return isJsonParent(value) ? parentBytesAsJson(value) : scalarBytesAsJson(value);
}
