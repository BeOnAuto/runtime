import { isList, isObject, type Json, type JsonArray, type JsonEntry, type JsonObject } from '../dsl/json.ts';

const shortEscapes: ReadonlySet<string> = new Set(['\b', '\t', '\n', '\f', '\r', '"', '\\']);

const firstOfTwoBytes = '\u0080';

const firstOfThreeBytes = '\u0800';

const surrogates = { first: '\uD800', last: '\uDFFF' };

const firstPrintable = ' ';

const escapedBytes = 6;

export const mostIssueBytes = 1024;

function isLoneSurrogate(character: string): boolean {
  return character.length === 1 && character >= surrogates.first && character <= surrogates.last;
}

function utf8BytesOf(character: string): number {
  if (character.length === 2) {
    return 4;
  }
  if (character < firstOfTwoBytes) {
    return 1;
  }
  return character < firstOfThreeBytes ? 2 : 3;
}

function escapedBytesOf(character: string): number {
  if (shortEscapes.has(character)) {
    return 2;
  }
  return character < firstPrintable || isLoneSurrogate(character) ? escapedBytes : utf8BytesOf(character);
}

function stringBytesWithin(text: string, most: number): number {
  let bytes = 2;
  for (const character of text) {
    bytes += escapedBytesOf(character);
    if (bytes > most) {
      return bytes;
    }
  }
  return bytes;
}

function itemsBytesWithin(items: JsonArray, most: number): number {
  let bytes = 1 + Math.max(items.length, 1);
  for (const item of items) {
    if (bytes > most) {
      return bytes;
    }
    bytes += jsonBytesWithin(item, most - bytes);
  }
  return bytes;
}

function entriesBytesWithin(object: JsonObject, most: number): number {
  const entries: readonly JsonEntry[] = Object.entries(object);
  let bytes = 1 + Math.max(entries.length, 1);
  for (const [key, item] of entries) {
    if (bytes > most) {
      return bytes;
    }
    bytes += stringBytesWithin(key, most - bytes) + 1;
    bytes += jsonBytesWithin(item, most - bytes);
  }
  return bytes;
}

export function jsonBytesWithin(value: Json, most: number): number {
  if (typeof value === 'string') {
    return stringBytesWithin(value, most);
  }
  if (isList(value)) {
    return itemsBytesWithin(value, most);
  }
  return isObject(value) ? entriesBytesWithin(value, most) : JSON.stringify(value).length;
}

export function utf8BytesWithin(text: string, most: number): number {
  let bytes = 0;
  for (const character of text) {
    bytes += utf8BytesOf(character);
    if (bytes > most) {
      return bytes;
    }
  }
  return bytes;
}

function lengthWithin(text: string, mostBytes: number): number {
  let bytes = 0;
  let length = 0;
  for (const character of text) {
    bytes += utf8BytesOf(character);
    if (bytes > mostBytes) {
      return length;
    }
    length += character.length;
  }
  return length;
}

export function textCutAt(text: string, mostBytes: number): string {
  return text.slice(0, lengthWithin(text, mostBytes));
}

export function textWithin(text: string, mostBytes: number): string {
  const kept = lengthWithin(text, mostBytes);
  return kept === text.length ? text : `${text.slice(0, kept)}…`;
}
