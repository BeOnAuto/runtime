import { Function } from 'effect';

import { enclosedBody } from '../dsl/expressions.ts';
import {
  entriesOf,
  field,
  isTruthy,
  jsonEquals,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from '../dsl/json.ts';
import { isConnectionSource } from './connection-sources.ts';

export type FilterAttribute<Test> =
  | { readonly name: string; readonly expected: Json }
  | { readonly name: string; readonly source: string; readonly test: Test };

export type Verdict<Test> = (test: Test, actual: Json, source: string) => Json;

export function filterAttributesOf<Test>(
  attributes: JsonObject,
  define: (source: string) => Test,
): readonly FilterAttribute<Test>[] {
  return entriesOf(attributes).map(([name, expected]: JsonEntry): FilterAttribute<Test> => {
    const source = enclosedBody(expected);
    return source === undefined ? { name, expected } : { name, source, test: define(source) };
  });
}

function namesAsWritten<Test>(attributes: readonly FilterAttribute<Test>[], name: string, value: Json): boolean {
  return attributes.some(
    (attribute) => attribute.name === name && 'expected' in attribute && jsonEquals(attribute.expected, value),
  );
}

export function mayTake<Test>(attributes: readonly FilterAttribute<Test>[], event: JsonObject): boolean {
  const source = textField(event, 'source');
  if (source === undefined || !isConnectionSource(source)) {
    return true;
  }
  const askedFor = field(event, 'automatic') !== true || namesAsWritten(attributes, 'automatic', true);
  return askedFor && namesAsWritten(attributes, 'source', source);
}

export function filterMayTake(attributes: JsonObject, event: JsonObject): boolean {
  return mayTake(filterAttributesOf(attributes, Function.identity), event);
}

function actualOf<Test>(attribute: FilterAttribute<Test>, event: JsonObject): Json {
  return field(event, attribute.name) ?? null;
}

export function attributeHolds<Test>(
  attribute: FilterAttribute<Test>,
  event: JsonObject,
  verdictOf: Verdict<Test>,
): boolean {
  const actual = actualOf(attribute, event);
  return 'expected' in attribute
    ? jsonEquals(attribute.expected, actual)
    : isTruthy(verdictOf(attribute.test, actual, attribute.source));
}

export async function attributeHoldsLater<Test>(
  attribute: FilterAttribute<Test>,
  event: JsonObject,
  verdictOf: (test: Test, actual: Json, source: string) => Promise<Json>,
): Promise<boolean> {
  const actual = actualOf(attribute, event);
  return 'expected' in attribute
    ? jsonEquals(attribute.expected, actual)
    : isTruthy(await verdictOf(attribute.test, actual, attribute.source));
}
