import { pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import { Option, Result, Schema } from 'effect';

import type { OutputMode } from '../model/model-result.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import { answerValueOf } from './described-answers.ts';
import {
  acceptsNull,
  choicesOf,
  definedIn,
  definitionsOf,
  isJsonObject,
  isMap,
  isObjectRoot,
  joined,
  stringsOf,
  type Definitions,
} from './schema-definitions.ts';
import type { Path } from './schema-nodes.ts';

export type Fits = (choice: Schema.Json, value: unknown) => boolean;

export interface ReadBack {
  readonly value: unknown;
  readonly issues: readonly SchemaIssue[];
  readonly writtenPointerOf: (pointer: string) => string;
}

export interface Mismatch {
  readonly issues: readonly SchemaIssue[];
  readonly written: readonly SchemaIssue[];
}

type Placement = readonly [author: string, written: string];

interface Place {
  readonly author: Path;
  readonly written: Path;
}

interface Read {
  readonly value: unknown;
  readonly places: readonly Placement[];
  readonly issues: readonly SchemaIssue[];
}

interface Reading {
  readonly definitions: Definitions;
  readonly fits: Fits;
}

interface KeyRead {
  readonly key: string;
  readonly read: Read;
}

interface Entry {
  readonly key: string;
  readonly value: unknown;
  readonly index: number;
}

type Reader = (schema: Schema.JsonObject, value: unknown, at: Place, reading: Reading) => Read | null;

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const isList = Schema.is(Schema.Array(Schema.Unknown));

const sharedKeywords: ReadonlySet<string> = new Set(['$schema', '$defs', 'definitions']);

const fitsByRoot = new WeakMap<Schema.JsonObject, Fits>();

function fitsNothing(): boolean {
  return false;
}

function checkOfDocument(document: Schema.Json): (value: unknown) => boolean {
  return Result.match(compileAnswerSchema(document), {
    onFailure: () => fitsNothing,
    onSuccess:
      ({ validate }) =>
      (value: unknown) =>
        Result.isSuccess(validate(value)),
  });
}

function sharedOf(root: Schema.JsonObject): Schema.JsonObject {
  return Object.fromEntries(
    Object.entries(root).filter(([keyword]: readonly [string, Schema.Json]) => sharedKeywords.has(keyword)),
  );
}

export function choiceFits(root: Schema.JsonObject): Fits {
  const known = fitsByRoot.get(root);
  if (known !== undefined) {
    return known;
  }
  const shared = sharedOf(root);
  const checks = new WeakMap<Schema.JsonObject, (value: unknown) => boolean>();
  const checkOf = (choice: Schema.JsonObject): ((value: unknown) => boolean) => {
    const checked = checks.get(choice);
    if (checked !== undefined) {
      return checked;
    }
    const made = checkOfDocument(joined(choice, shared));
    checks.set(choice, made);
    return made;
  };
  const fits: Fits = (choice, value) => (isJsonObject(choice) ? checkOf(choice) : checkOfDocument(choice))(value);
  fitsByRoot.set(root, fits);
  return fits;
}

function placementOf({ author, written }: Place): Placement {
  return [pointerOf(author), pointerOf(written)];
}

function kept(at: Place, value: unknown): Read {
  return { value, places: [placementOf(at)], issues: [] };
}

function gathered(at: Place, value: unknown, reads: readonly Read[]): Read {
  return {
    value,
    places: [placementOf(at), ...reads.flatMap(({ places }) => places)],
    issues: reads.flatMap(({ issues }) => issues),
  };
}

function below(at: Place, author: string | number, written: readonly (string | number)[]): Place {
  return { author: [...at.author, author], written: [...at.written, ...written] };
}

const readChoice: Reader = (schema, value, at, reading) => {
  const choices = choicesOf(schema);
  if (choices.length === 0) {
    return null;
  }
  for (const choice of choices) {
    const read = readAt(choice, value, at, reading);
    if (reading.fits(choice, read.value)) {
      return read;
    }
  }
  return kept(at, value);
};

function entryOf(item: unknown, index: number): readonly Entry[] {
  return isRecord(item) && typeof item['key'] === 'string' ? [{ key: item['key'], value: item['value'], index }] : [];
}

function repeatedKeyIssues(
  entries: readonly Entry[],
  firsts: ReadonlyMap<string, Entry>,
  at: Place,
): readonly SchemaIssue[] {
  const repeated = new Set(entries.filter((entry) => firsts.get(entry.key) !== entry).map(({ key }) => key));
  return [...repeated].map((key) => ({
    pointer: pointerOf(at.author),
    detail: `Expected each key once; ${JSON.stringify(key)} is given more than once`,
  }));
}

const readMap: Reader = (schema, value, at, reading) => {
  if (!isList(value) || !isMap(schema)) {
    return null;
  }
  const entries = value.flatMap((item, index) => entryOf(item, index));
  if (entries.length < value.length) {
    return kept(at, value);
  }
  const firsts = new Map<string, Entry>();
  for (const entry of entries) {
    if (!firsts.has(entry.key)) {
      firsts.set(entry.key, entry);
    }
  }
  const reads = [...firsts.values()].map((entry): KeyRead => ({
    key: entry.key,
    read: readAt(schema['additionalProperties'], entry.value, below(at, entry.key, [entry.index, 'value']), reading),
  }));
  const read = gathered(
    at,
    Object.fromEntries(reads.map(({ key, read: entryRead }: KeyRead) => [key, entryRead.value])),
    reads.map(({ read: entryRead }: KeyRead) => entryRead),
  );
  return { ...read, issues: [...repeatedKeyIssues(entries, firsts, at), ...read.issues] };
};

interface Declared {
  readonly properties: Schema.JsonObject;
  readonly required: ReadonlySet<string>;
}

function readProperty(
  [name, given]: readonly [string, unknown],
  { properties, required }: Declared,
  at: Place,
  reading: Reading,
): readonly (readonly [string, Read])[] {
  const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
  if (property === undefined) {
    return [[name, { value: given, places: [], issues: [] }]];
  }
  if (given === null && !required.has(name) && !acceptsNull(reading.definitions, property)) {
    return [];
  }
  return [[name, readAt(property, given, below(at, name, [name]), reading)]];
}

const readObject: Reader = (schema, value, at, reading) => {
  const properties = schema['properties'];
  if (!isRecord(value) || !isJsonObject(properties)) {
    return null;
  }
  const declared = { properties, required: new Set(stringsOf(schema['required'])) };
  const reads = Object.entries(value).flatMap((entry: readonly [string, unknown]) =>
    readProperty(entry, declared, at, reading),
  );
  return gathered(
    at,
    Object.fromEntries(reads.map(([name, read]: readonly [string, Read]) => [name, read.value])),
    reads.map(([, read]: readonly [string, Read]) => read),
  );
};

const readItems: Reader = (schema, value, at, reading) => {
  const items = schema['items'];
  if (!isList(value) || items === undefined) {
    return null;
  }
  const reads = value.map((item, index) => readAt(items, item, below(at, index, [index]), reading));
  return gathered(
    at,
    reads.map(({ value: read }) => read),
    reads,
  );
};

const readers: readonly Reader[] = [readChoice, readMap, readObject, readItems];

function readAt(node: Schema.Json | undefined, value: unknown, at: Place, reading: Reading): Read {
  const schema = definedIn(reading.definitions, node);
  if (!isJsonObject(schema)) {
    return kept(at, value);
  }
  for (const reader of readers) {
    const read = reader(schema, value, at, reading);
    if (read !== null) {
      return read;
    }
  }
  return kept(at, value);
}

function writtenPointerIn(placesInReadingOrder: readonly Placement[], pointer: string): string {
  const [author, written] = placesInReadingOrder
    .filter(([placed]) => pointer === placed || pointer.startsWith(`${placed}/`))
    .reduce<Placement>((_shallower, deeper) => deeper, ['', '']);
  return `${written}${pointer.slice(author.length)}`;
}

export function readBack(root: Schema.JsonObject, written: unknown): ReadBack {
  const wrapped = !isObjectRoot(root);
  const value = wrapped && isRecord(written) ? written['value'] : written;
  const reading = { definitions: definitionsOf(root), fits: choiceFits(root) };
  const read = readAt(root, value, { author: [], written: wrapped ? ['value'] : [] }, reading);
  return {
    value: read.value,
    issues: read.issues,
    writtenPointerOf: (pointer) => writtenPointerIn(read.places, pointer),
  };
}

function mismatchOf({ writtenPointerOf }: ReadBack, issues: readonly SchemaIssue[]): Mismatch {
  return { issues, written: issues.map(({ pointer, detail }) => ({ pointer: writtenPointerOf(pointer), detail })) };
}

export function portableAnswerOf(schema: AnswerSchema, written: unknown): Result.Result<Schema.Json, Mismatch> {
  const read = readBack(schema.document, written);
  return Result.match(schema.validate(read.value), {
    onSuccess: (json) => (read.issues.length === 0 ? Result.succeed(json) : Result.fail(mismatchOf(read, read.issues))),
    onFailure: (issues) => Result.fail(mismatchOf(read, [...read.issues, ...issues])),
  });
}

export function keptAnswerOf(
  text: string,
  schema: AnswerSchema,
  mode: OutputMode | undefined,
): Option.Option<Result.Result<Schema.Json, readonly SchemaIssue[]>> {
  return Option.map(answerValueOf(text), (json) =>
    mode === 'portable'
      ? Result.mapError(portableAnswerOf(schema, json), ({ issues }) => issues)
      : schema.validate(json),
  );
}
