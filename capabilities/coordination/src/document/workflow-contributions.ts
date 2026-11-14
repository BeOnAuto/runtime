import { ContributesSchema, type Contributes } from '@on.auto/definitions/goals';
import { isJsonPointer } from '@on.auto/definitions/tool-blocks';

export type { Contributes } from '@on.auto/definitions/goals';
import {
  enclosedBody,
  entriesOf,
  field,
  isList,
  isObject,
  pointerTo,
  rejection,
  type Json,
  type JsonEntry,
  type JsonObject,
  type PlacedExpression,
  type Rejection,
} from '@on.auto/workflow-engine';
import { Schema } from 'effect';

import { unknownPropertyWords } from '../dsl/schema-problems.ts';

const contributesKey = 'contributes';

const mostContributions = 8;

const contributesPlace = `/${contributesKey}`;

const conditionNames = ['$data'];

type ValueCheck = (value: Json) => string | undefined;

function isPointer(value: Json): boolean {
  return typeof value === 'string' && isJsonPointer(value);
}

const wordsCheck: ValueCheck = (value) =>
  typeof value === 'string' && value.trim() !== '' ? undefined : 'It must be words, not left blank';

const pointerCheck: ValueCheck = (value) =>
  isPointer(value) ? undefined : 'It must be a pointer into the output that starts with a slash, such as /total';

const conditionCheck: ValueCheck = (value) =>
  enclosedBody(value) === undefined ? 'It must be one expression over $data, written in ${ }' : undefined;

const finalCheck: ValueCheck = (value) =>
  value === true || isPointer(value)
    ? undefined
    : 'It must be true, or a pointer to a boolean in the output, such as /window_closed';

const entryChecks: ReadonlyMap<string, ValueCheck> = new Map([
  ['goal', wordsCheck],
  ['purpose', wordsCheck],
  ['each', pointerCheck],
  ['per_id', pointerCheck],
  ['title', pointerCheck],
  ['link', pointerCheck],
  ['when', conditionCheck],
  ['marks', wordsCheck],
  ['measures', pointerCheck],
  ['final', finalCheck],
  ['as_of', pointerCheck],
  ['says', pointerCheck],
]);

const requiredKeys = ['goal', 'purpose'];

function keyRejections([key, value]: JsonEntry, pointer: string): readonly Rejection[] {
  const check = entryChecks.get(key);
  if (check === undefined) {
    return [rejection(pointer, `It has ${key}, which a contribution does not know`)];
  }
  const refused = check(value);
  return refused === undefined ? [] : [rejection(pointerTo(pointer, key), refused)];
}

function entryRejections(entry: JsonObject, pointer: string): readonly Rejection[] {
  return [
    ...requiredKeys
      .filter((key) => field(entry, key) === undefined)
      .map((key) => rejection(pointer, `It needs ${key}`)),
    ...entriesOf(entry).flatMap((entered: JsonEntry) => keyRejections(entered, pointer)),
  ];
}

function listedRejections(contributes: readonly Json[]): readonly Rejection[] {
  if (contributes.length > mostContributions) {
    return [
      rejection(
        contributesPlace,
        `It has ${contributes.length} contributions, and a workflow has at most ${mostContributions}`,
      ),
    ];
  }
  return contributes.flatMap((entry, index) => {
    const pointer = pointerTo(contributesPlace, index);
    return isObject(entry)
      ? entryRejections(entry, pointer)
      : [rejection(pointer, 'It must be a mapping that names a goal and its purpose')];
  });
}

function contributionRejections(written: Json | undefined): readonly Rejection[] {
  if (written === undefined) {
    return [];
  }
  return isList(written)
    ? listedRejections(written)
    : [rejection(contributesPlace, `It must be a list of at most ${mostContributions} contributions`)];
}

const decodedContributes = Schema.decodeUnknownSync(ContributesSchema);

export function contributesOf(written: Json | undefined): { readonly contributes?: Contributes } {
  return written === undefined ? {} : { contributes: decodedContributes(written) };
}

export function contributionExpressionsOf(contributes: Contributes = []): readonly PlacedExpression[] {
  return contributes.flatMap(({ when }, index) => {
    const source = enclosedBody(when);
    return source === undefined
      ? []
      : [{ pointer: pointerTo(pointerTo(contributesPlace, index), 'when'), source, names: conditionNames }];
  });
}

export const contributesUnknown: Rejection = rejection('', unknownPropertyWords(contributesKey));

export function withoutContributions(value: JsonObject): {
  readonly written: Json | undefined;
  readonly document: JsonObject;
} {
  return {
    written: field(value, contributesKey),
    document: Object.fromEntries(entriesOf(value).filter(([key]: JsonEntry) => key !== contributesKey)),
  };
}

export function contributionProblems(
  written: Json | undefined,
  goals: boolean,
  others: readonly Pick<Rejection, 'pointer'>[],
): readonly Rejection[] {
  const rejections = contributionRejections(written);
  if (goals || written === undefined) {
    return rejections;
  }
  return rejections.length > 0 || others.length > 0 ? [contributesUnknown] : [];
}
