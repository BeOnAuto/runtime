import { leastCount } from '@on.auto/operations';
import { Function } from 'effect';

import { enclosedBody } from '../dsl/expressions.ts';
import { entriesOf, field, isObject, objectField, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import { forbidden, rejection, type Rejection } from '../dsl/policy-checks.ts';
import { eventFilterRejections, eventFiltersOf, type LocatedFilter } from '../dsl/task-policy.ts';
import { pointerTo } from '../dsl/tasks.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { attributeHolds, filterAttributesOf } from './attribute-match.ts';

type ExpressionVerdict = (expression: string, value: Json) => Json;

export interface LiteralFilter {
  readonly reference: string;
  readonly type: string;
  readonly attributes: JsonObject;
}

export type LiteralFilterReading = { readonly filter: LiteralFilter } | { readonly rejections: readonly Rejection[] };

export type FilterVerdict = boolean | { readonly error: DslError; readonly stopped: boolean };

const filterKeys: ReadonlySet<string> = new Set(['with', 'correlate']);

const wholeNumberAttributes: ReadonlySet<string> = new Set(['depth', 'calldepth', 'definitionversion']);

const attributeName = /^[a-z0-9]{1,20}$/u;

export function hasAttributes(event: JsonObject, attributes: JsonObject, verdictOf: ExpressionVerdict): boolean {
  return filterAttributesOf(attributes, Function.identity).every((attribute) =>
    attributeHolds(attribute, event, (expression, actual) => verdictOf(expression, actual)),
  );
}

function strayKeyRejections(filter: JsonObject, attributes: JsonObject, pointer: string): readonly Rejection[] {
  const strayKeys = Object.keys(filter)
    .filter((key) => !filterKeys.has(key))
    .map((key) => forbidden(pointerTo(pointer, key), `${key} is not part of an event filter, which takes with`));
  const strayAttributes = Object.keys(attributes)
    .filter((name) => !attributeName.test(name))
    .map((name) =>
      forbidden(
        pointerTo(`${pointer}/with`, name),
        `An event filter names an attribute of the event as CloudEvents names it, in at most 20 lowercase letters and digits, not ${name}`,
      ),
    );
  return [...strayKeys, ...strayAttributes];
}

function countedAttributeWords(name: string): string {
  return `${name} is a whole number from ${leastCount}, written out; a run no reaction started carries no depth and a run no call started no calldepth, so a filter for such runs leaves the attribute out`;
}

function wholeNumberRejection(name: string, expected: Json, pointer: string): readonly Rejection[] {
  return typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= leastCount
    ? []
    : [rejection(pointer, countedAttributeWords(name))];
}

function literalRejection(name: string, expected: Json, pointer: string): readonly Rejection[] {
  if (wholeNumberAttributes.has(name)) {
    return wholeNumberRejection(name, expected, pointer);
  }
  if (typeof expected !== 'string' || expected === '') {
    return [rejection(pointer, `${name} is text that is not empty`)];
  }
  return enclosedBody(expected) === undefined
    ? []
    : [forbidden(pointer, `${name} is written out, not computed by an expression, so that it is matched as it is`)];
}

function literalRejections(attributes: JsonObject, pointer: string): readonly Rejection[] {
  const typeNamed =
    field(attributes, 'type') === undefined
      ? [
          rejection(
            pointerTo(`${pointer}/with`, 'type'),
            'An event filter matched over the event alone names the type of the events it takes',
          ),
        ]
      : [];
  const literals = entriesOf(attributes)
    .filter(([name]: JsonEntry) => name !== 'data' && attributeName.test(name))
    .flatMap(([name, expected]: JsonEntry) => literalRejection(name, expected, pointerTo(`${pointer}/with`, name)));
  return [...typeNamed, ...literals];
}

export function literalFilterOf(filter: Json | undefined, pointer: string): LiteralFilterReading {
  const attributes = isObject(filter) ? objectField(filter, 'with') : undefined;
  if (!isObject(filter) || attributes === undefined) {
    return {
      rejections: [rejection(pointer, 'An event filter is a mapping whose with holds the attributes to match')],
    };
  }
  const type = field(attributes, 'type');
  const rejections = [
    ...eventFilterRejections(filter, pointer),
    ...strayKeyRejections(filter, attributes, pointer),
    ...literalRejections(attributes, pointer),
  ];
  if (typeof type !== 'string' || rejections.length > 0) {
    return { rejections };
  }
  return { filter: { reference: pointer, type, attributes } };
}

export function playbookWideFilterOf(filter: Json | undefined): JsonObject | undefined {
  const attributes = isObject(filter) ? objectField(filter, 'with') : undefined;
  const type = attributes === undefined ? undefined : field(attributes, 'type');
  return typeof type === 'string' && type !== '' && enclosedBody(type) === undefined ? attributes : undefined;
}

export function listenFiltersOf(task: Json | undefined): readonly JsonObject[] {
  const to = objectField(objectField(isObject(task) ? task : {}, 'listen') ?? {}, 'to') ?? {};
  return eventFiltersOf(to, '').flatMap(([filter]: LocatedFilter) => {
    const attributes = playbookWideFilterOf(filter);
    return attributes === undefined ? [] : [attributes];
  });
}

export function listenerFilterOf(attributes: JsonObject, reference: string): LiteralFilter | undefined {
  const type = field(attributes, 'type');
  if (typeof type !== 'string' || playbookWideFilterOf({ with: attributes }) === undefined) {
    return undefined;
  }
  return { reference, type, attributes };
}
