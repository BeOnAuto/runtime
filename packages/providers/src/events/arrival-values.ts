import { valueAt } from '@on.auto/definitions/tool-blocks';
import type { Schema } from 'effect';

import {
  messageReferenceOf,
  requestReferenceOf,
  type MessageReference,
  type RequestReference,
} from './runtime-expressions.ts';

interface RequestArrival {
  readonly transport: 'request';
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: Schema.Json;
}

interface MessageArrival {
  readonly transport: 'message';
  readonly headers?: Schema.Json;
  readonly payload: Schema.Json;
}

export type Arrival = RequestArrival | MessageArrival;

export type Conditions = Readonly<Record<string, readonly (string | null)[]>>;

export function headerIn(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const named = name.toLowerCase();
  const values = Object.entries(headers).flatMap(([field, value]: readonly [string, string]) =>
    field.toLowerCase() === named ? [value] : [],
  );
  return values.length === 0 ? undefined : values.join(', ');
}

function inTheRequest({ headers, query, body }: RequestArrival, reference: RequestReference): unknown {
  if (reference.source === 'body') {
    return valueAt(body, reference.pointer);
  }
  if (reference.source === 'header') {
    return headerIn(headers, reference.name);
  }
  return Object.hasOwn(query, reference.name) ? query[reference.name] : undefined;
}

function inTheMessage({ headers, payload }: MessageArrival, { source, pointer }: MessageReference): unknown {
  return valueAt(source === 'header' ? headers : payload, pointer);
}

export function valueIn(arrival: Arrival, expression: string): unknown {
  if (arrival.transport === 'request') {
    const reference = requestReferenceOf(expression);
    return reference === undefined ? undefined : inTheRequest(arrival, reference);
  }
  const reference = messageReferenceOf(expression);
  return reference === undefined ? undefined : inTheMessage(arrival, reference);
}

export function declaredValueIn(arrival: Arrival, expression: string | undefined): unknown {
  return expression === undefined ? undefined : valueIn(arrival, expression);
}

export function textIn(arrival: Arrival, expression: string | undefined): string | undefined {
  const value = declaredValueIn(arrival, expression);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function holdsSomething(arrival: Arrival, expression: string | undefined): boolean {
  return (declaredValueIn(arrival, expression) ?? null) !== null;
}

function isOneOf(value: unknown, values: readonly (string | null)[]): boolean {
  return (value ?? null) === null ? values.includes(null) : typeof value === 'string' && values.includes(value);
}

export function holds(arrival: Arrival, when: Conditions): boolean {
  const conditions = Object.entries(when);
  return (
    conditions.length > 0 &&
    conditions.every(([expression, values]: readonly [string, readonly (string | null)[]]) =>
      isOneOf(valueIn(arrival, expression), values),
    )
  );
}

export function applies(arrival: Arrival, declared: string | Conditions | undefined): boolean {
  if (declared === undefined) {
    return false;
  }
  return typeof declared === 'string' ? holdsSomething(arrival, declared) : holds(arrival, declared);
}
