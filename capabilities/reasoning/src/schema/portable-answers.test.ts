import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { measuredSchemas, type AnswerSchemaCase } from '../schema-testing/answer-schemas.ts';
import { auditSchemas } from '../schema-testing/audit-schemas.ts';
import { revisionSchemas } from '../schema-testing/revision-schemas.ts';
import { readBack } from './answer-reading.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import { portableFormOf } from './portable-schema.ts';

const movedBounds: ReadonlySet<string> = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'format',
]);

const valuesOfEachSchema = 200;

const repeatedKey = /^Expected each key once; ".*" is given more than once$/u;

const letters: readonly string[] = ['a', 'b', 'c', 'x', 'y', 'z', ' ', '-', 'é'];

interface Making {
  readonly definitions: Schema.JsonObject;
  readonly next: () => number;
}

interface Outcome {
  readonly writtenTaken: boolean;
  readonly repeatedKeysOnly: boolean;
  readonly readBackTaken: boolean;
}

function isObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function listOf(value: Schema.Json | undefined): readonly Schema.Json[] {
  return isList(value) ? value : [];
}

function withoutMovedBounds(value: Schema.Json): Schema.Json {
  if (isList(value)) {
    return value.map((entry) => withoutMovedBounds(entry));
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([keyword]: readonly [string, Schema.Json]) => !movedBounds.has(keyword))
      .map(([keyword, entry]: readonly [string, Schema.Json]) => [keyword, withoutMovedBounds(entry)]),
  );
}

function compiled(document: Schema.Json): AnswerSchema {
  return Result.getOrThrow(compileAnswerSchema(document));
}

function randomness(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) % 2 ** 32;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

function pick<Value>(values: readonly Value[], { next }: Making): Value | undefined {
  return values[Math.floor(next() * values.length)];
}

function textOf(making: Making): string {
  return Array.from({ length: Math.floor(making.next() * 9) }, () => pick(letters, making) ?? 'a').join('');
}

function objectOf(schema: Schema.JsonObject, making: Making): Schema.JsonObject {
  const properties = isObject(schema['properties']) ? schema['properties'] : {};
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]: readonly [string, Schema.Json]) => [
      name,
      valueOf(property, making),
    ]),
  );
}

function valueOfType(type: string | undefined, schema: Schema.JsonObject, making: Making): Schema.Json {
  const makers: Readonly<Record<string, () => Schema.Json>> = {
    object: () => objectOf(schema, making),
    array: () => Array.from({ length: Math.floor(making.next() * 4) }, () => valueOf(schema['items'], making)),
    string: () => textOf(making),
    number: () => Math.round((making.next() - 0.5) * 2000) / 100,
    integer: () => Math.floor((making.next() - 0.5) * 200),
    boolean: () => making.next() < 0.5,
  };
  return makers[type ?? 'null']?.() ?? null;
}

function valueOf(node: Schema.Json | undefined, making: Making): Schema.Json {
  if (!isObject(node)) {
    return null;
  }
  const reference = node['$ref'];
  if (typeof reference === 'string') {
    return valueOf(making.definitions[reference.split('/').at(-1) ?? ''], making);
  }
  const choices = listOf(node['anyOf']);
  if (choices.length > 0) {
    return valueOf(pick(choices, making), making);
  }
  const values = listOf(node['enum']);
  if (values.length > 0) {
    return pick(values, making) ?? null;
  }
  const type = node['type'];
  const types = listOf(type).filter((name) => typeof name === 'string');
  return valueOfType(typeof type === 'string' ? type : pick(types, making), node, making);
}

function outcomesOf({ document }: AnswerSchemaCase, seed: number): readonly Outcome[] {
  const form = portableFormOf(compiled(document));
  const sent = form.portable ? form.sent : {};
  const making = { definitions: isObject(sent['$defs']) ? sent['$defs'] : {}, next: randomness(seed) };
  const portable = compiled(sent);
  const loose = compiled(withoutMovedBounds(document));
  return Array.from({ length: valuesOfEachSchema }, () => {
    const written = valueOf(sent, making);
    const read = readBack(document, written);
    return {
      writtenTaken: Result.isSuccess(portable.validate(written)),
      repeatedKeysOnly: read.issues.every(({ detail }) => repeatedKey.test(detail)),
      readBackTaken: read.issues.length > 0 || Result.isSuccess(loose.validate(read.value)),
    };
  });
}

function isFaithful({ writtenTaken, repeatedKeysOnly, readBackTaken }: Outcome): boolean {
  return writtenTaken && repeatedKeysOnly && readBackTaken;
}

const portableCases = [...measuredSchemas, ...auditSchemas, ...revisionSchemas].filter(
  ({ issues }) => issues.length === 0,
);

describe('an answer of any shape the portable form takes', () => {
  it.each(portableCases.map((one, index) => [one.name, one, index + 1] as const))(
    'reads back to one the schema as written takes, but for the bounds put into words and a key given twice: %s',
    (_name, one, seed) => {
      expect(outcomesOf(one, seed).filter((outcome) => !isFaithful(outcome))).toEqual([]);
    },
  );
});
