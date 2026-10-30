import { Schema } from 'effect';

export type Json = null | boolean | number | string | JsonArray | JsonObject;

export interface JsonArray extends ReadonlyArray<Json> {}

export interface JsonObject {
  readonly [key: string]: Json;
}

export type JsonEntry = readonly [string, Json];

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isList(value: Json | undefined): value is JsonArray {
  return Array.isArray(value);
}

export function field(object: JsonObject, key: string): Json | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

export function textField(object: JsonObject, key: string): string | undefined {
  const value = field(object, key);
  return typeof value === 'string' ? value : undefined;
}

export function objectField(object: JsonObject, key: string): JsonObject | undefined {
  const value = field(object, key);
  return isObject(value) ? value : undefined;
}

export function listField(object: JsonObject, key: string): JsonArray | undefined {
  const value = field(object, key);
  return isList(value) ? value : undefined;
}

export function entriesOf(object: JsonObject): readonly JsonEntry[] {
  return Object.entries(object);
}

export function isTruthy(value: Json): boolean {
  return value !== null && value !== false;
}

export function jsonEquals(left: Json | undefined, right: Json | undefined): boolean {
  if (isList(left) && isList(right)) {
    return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => jsonEquals(left[key], right[key]));
  }
  return left === right;
}

const utf8 = new TextEncoder();

export function jsonBytesOf(value: Json): number {
  return utf8.encode(JSON.stringify(value)).length;
}

export function withinBytes(text: string, mostBytes: number): string {
  const { read } = utf8.encodeInto(text, new Uint8Array(mostBytes));
  return text.slice(0, read);
}

export function itemAt(value: Json, index: number): Json | undefined {
  return isList(value) ? value[index] : undefined;
}

export function valueAtPointer(value: Json, pointer: string): Json | undefined {
  const tokens = pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  return tokens.reduce<Json | undefined>((current, token) => {
    if (isList(current)) {
      return current[Number(token)];
    }
    return isObject(current) ? field(current, token) : undefined;
  }, value);
}

export const jsonOfText: (text: string) => Json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

export const mostValueDepth = 512;

export interface Measure {
  readonly work: number;
  readonly depth: number;
}

interface Part {
  readonly keyWork: number;
  readonly measure: Measure | undefined;
}

interface MeasuredPart {
  readonly keyWork: number;
  readonly measure: Measure;
}

const valueWork = 16;

const measures = new WeakMap<object, Measure>();

export function measureOf(value: unknown, room = mostValueDepth): Measure | undefined {
  return Array.isArray(value) || isPlainObject(value) ? containerMeasureOf(value, room) : scalarMeasureOf(value);
}

function scalarMeasureOf(value: unknown): Measure | undefined {
  if (typeof value === 'string') {
    return { work: value.length + valueWork, depth: 0 };
  }
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    ? { work: valueWork, depth: 0 }
    : undefined;
}

function containerMeasureOf(value: object, room: number): Measure | undefined {
  const known = measures.get(value);
  if (known !== undefined) {
    return known.depth <= room ? known : undefined;
  }
  return room === 0 ? undefined : measureContainer(value, room);
}

function measureContainer(value: object, room: number): Measure | undefined {
  const parts: readonly Part[] = Array.isArray(value)
    ? value.map((item: unknown) => ({ keyWork: 0, measure: measureOf(item, room - 1) }))
    : Object.entries(value).map(([key, item]: readonly [string, unknown]) => ({
        keyWork: key.length,
        measure: measureOf(item, room - 1),
      }));
  const measured = parts.flatMap(({ keyWork, measure }: Part): readonly MeasuredPart[] =>
    measure === undefined ? [] : [{ keyWork, measure }],
  );
  if (measured.length < parts.length) {
    return undefined;
  }
  const measure = {
    work: measured.reduce((sum: number, part: MeasuredPart) => sum + part.keyWork + part.measure.work, valueWork),
    depth: 1 + measured.reduce((deepest: number, part: MeasuredPart) => Math.max(deepest, part.measure.depth), 0),
  };
  measures.set(value, measure);
  return measure;
}

export function isJson(value: unknown, room = mostValueDepth): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (room === 0) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isJson(item, room - 1));
  }
  return isPlainObject(value) && Object.values(value).every((item: unknown) => isJson(item, room - 1));
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
