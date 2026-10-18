import { durationInWords } from '@on.auto/definitions';
import {
  enclosedBody,
  field,
  isList,
  isObject,
  objectField,
  readDuration,
  type Json,
  type JsonObject,
} from '@on.auto/workflow-engine';

import { literalText } from '../document/workflow-functions.ts';

type ListenMode = 'one' | 'any' | 'all';

export interface Listened {
  readonly mode: ListenMode;
  readonly types: readonly (string | undefined)[];
}

const listenModes: readonly ListenMode[] = ['one', 'any', 'all'];

const runKinds: readonly string[] = ['container', 'script', 'shell', 'workflow'];

export function objectAt(value: JsonObject, ...keys: readonly string[]): JsonObject {
  return keys.reduce<JsonObject>((current, key) => objectField(current, key) ?? {}, value);
}

export function expressionText(value: Json): string {
  return typeof value === 'string' ? (enclosedBody(value) ?? value).trim() : JSON.stringify(value);
}

export function durationText(value: Json | undefined): string | undefined {
  const reading = value === undefined ? undefined : readDuration(value);
  return reading !== undefined && 'milliseconds' in reading ? durationInWords(reading.milliseconds) : undefined;
}

function filterType(filter: Json): string | undefined {
  return literalText(field(objectAt({ filter }, 'filter', 'with'), 'type'));
}

export function listenedOf(task: JsonObject): Listened {
  const to = objectAt(task, 'listen', 'to');
  const mode = listenModes.find((each) => field(to, each) !== undefined) ?? 'one';
  const filters = field(to, mode);
  return { mode, types: isList(filters) ? filters.map((filter) => filterType(filter)) : [filterType(filters ?? {})] };
}

export function namedKeys(value: Json | undefined): readonly string[] | undefined {
  return isObject(value) ? Object.keys(value) : undefined;
}

export function runKindOf(task: JsonObject): string | undefined {
  const run = objectAt(task, 'run');
  return runKinds.find((kind) => field(run, kind) !== undefined);
}
