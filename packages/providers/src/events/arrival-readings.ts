import { valueAt } from '@on.auto/definitions/tool-blocks';
import { Schema } from 'effect';

import type { Destination } from './destination-fields.ts';
import { eventTimeOf } from './event-times.ts';
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

interface ArrivalHandshake {
  readonly challenge?: string;
}

interface DeliveredReply {
  readonly account: string;
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  readonly to: string;
  readonly time?: string | number;
}

interface ArrivalWake {
  readonly subscription?: string;
  readonly conversation?: string;
  readonly reply?: DeliveredReply;
}

interface ArrivalConnection {
  readonly account?: string;
  readonly user?: string;
}

interface ArrivalEvent {
  readonly type: string;
  readonly id: string;
  readonly time?: string;
  readonly subject?: string;
  readonly data: Readonly<Record<string, Schema.Json>>;
  readonly automatic?: boolean;
  readonly actor?: string;
}

export interface ArrivalReading {
  readonly handshake?: ArrivalHandshake;
  readonly wake?: ArrivalWake;
  readonly connection?: ArrivalConnection;
  readonly event?: ArrivalEvent;
}

type Conditions = Readonly<Record<string, readonly (string | null)[]>>;

type DeclaredReply = NonNullable<Destination['filter']['reply']>;

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

function holdsSomething(arrival: Arrival, expression: string | undefined): boolean {
  return (declaredValueIn(arrival, expression) ?? null) !== null;
}

function isOneOf(value: unknown, values: readonly (string | null)[]): boolean {
  return (value ?? null) === null ? values.includes(null) : typeof value === 'string' && values.includes(value);
}

function holds(arrival: Arrival, when: Conditions): boolean {
  const conditions = Object.entries(when);
  return (
    conditions.length > 0 &&
    conditions.every(([expression, values]: readonly [string, readonly (string | null)[]]) =>
      isOneOf(valueIn(arrival, expression), values),
    )
  );
}

function applies(arrival: Arrival, declared: string | Conditions | undefined): boolean {
  if (declared === undefined) {
    return false;
  }
  return typeof declared === 'string' ? holdsSomething(arrival, declared) : holds(arrival, declared);
}

function timeIn(arrival: Arrival, expression: string | undefined): Pick<DeliveredReply, 'time'> {
  const time = declaredValueIn(arrival, expression);
  return typeof time === 'string' || typeof time === 'number' ? { time } : {};
}

function replyIn(arrival: Arrival, reply: DeclaredReply, account: string | undefined): DeliveredReply | undefined {
  if (account === undefined || holdsSomething(arrival, reply.changed)) {
    return undefined;
  }
  const id = textIn(arrival, reply.id);
  const sender = textIn(arrival, reply.sender);
  const to = textIn(arrival, reply.to);
  const text = valueIn(arrival, reply.text);
  return id === undefined || sender === undefined || to === undefined || typeof text !== 'string'
    ? undefined
    : { account, id, sender, text, to, ...timeIn(arrival, reply.time) };
}

function namedIn(arrival: Arrival, filter: Destination['filter']): Omit<ArrivalWake, 'reply'> {
  const subscription = textIn(arrival, filter.subscription);
  const conversation = textIn(arrival, filter.conversation);
  return {
    ...(subscription === undefined ? {} : { subscription }),
    ...(conversation === undefined ? {} : { conversation }),
  };
}

function wakeIn(arrival: Arrival, filter: Destination['filter'], account: string | undefined): ArrivalWake | undefined {
  if (!holds(arrival, filter.when) || holdsSomething(arrival, filter.automatic)) {
    return undefined;
  }
  const named = namedIn(arrival, filter);
  const reply =
    named.conversation === undefined || filter.reply === undefined
      ? undefined
      : replyIn(arrival, filter.reply, account);
  return reply === undefined ? named : { ...named, reply };
}

function connectionIn(arrival: Arrival, connection: Destination['connection']): ArrivalConnection | undefined {
  const account = textIn(arrival, connection?.account);
  const user = textIn(arrival, connection?.user);
  if (account === undefined && user === undefined) {
    return undefined;
  }
  return { ...(account === undefined ? {} : { account }), ...(user === undefined ? {} : { user }) };
}

function handshakeIn(arrival: Arrival, handshake: Destination['handshake']): ArrivalHandshake | undefined {
  if (handshake === undefined || !holds(arrival, handshake.when)) {
    return undefined;
  }
  const challenge = textIn(arrival, handshake.challenge);
  return challenge === undefined ? {} : { challenge };
}

type DeclaredEvent = NonNullable<Destination['events']>[number];

interface Matched {
  readonly declared: DeclaredEvent;
  readonly id: string;
}

function idPartIn(arrival: Arrival, expression: string): string | undefined {
  const value = valueIn(arrival, expression);
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function idIn(arrival: Arrival, parts: readonly string[]): string | undefined {
  const read = parts.map((part) => idPartIn(arrival, part));
  return read.every((part): part is string => part !== undefined)
    ? read.map((part) => encodeURIComponent(part)).join('/')
    : undefined;
}

function matchedIn(arrival: Arrival, mappings: readonly DeclaredEvent[]): Matched | undefined {
  return mappings.flatMap((declared): readonly Matched[] => {
    const id = holds(arrival, declared.when) ? idIn(arrival, declared.id) : undefined;
    return id === undefined ? [] : [{ declared, id }];
  })[0];
}

const isJson = Schema.is(Schema.Json);

function dataIn(arrival: Arrival, data: DeclaredEvent['data'] = {}): Readonly<Record<string, Schema.Json>> {
  return Object.fromEntries(
    Object.entries(data).flatMap(([field, expression]: readonly [string, string]) => {
      const value = valueIn(arrival, expression);
      return value === null || !isJson(value) ? [] : [[field, value]];
    }),
  );
}

function actorIn(arrival: Arrival, expression: string | undefined): Pick<ArrivalEvent, 'actor'> {
  const named = declaredValueIn(arrival, expression);
  if (typeof named === 'number') {
    return Number.isSafeInteger(named) ? { actor: String(named) } : {};
  }
  return typeof named === 'string' && named !== '' ? { actor: named } : {};
}

function isItsOwn(arrival: Arrival, own: DeclaredEvent['own']): boolean {
  if (own === undefined) {
    return false;
  }
  const [doneBy, actingAs] = own;
  const account = textIn(arrival, doneBy);
  return account !== undefined && account === textIn(arrival, actingAs);
}

function eventIn(arrival: Arrival, mappings: Destination['events']): ArrivalEvent | undefined {
  const matched = matchedIn(arrival, mappings ?? []);
  if (matched === undefined) {
    return undefined;
  }
  const { declared, id } = matched;
  if (applies(arrival, declared.changed) || isItsOwn(arrival, declared.own)) {
    return undefined;
  }
  const time = eventTimeOf(declaredValueIn(arrival, declared.time));
  const subject = textIn(arrival, declared.subject);
  return {
    type: declared.type,
    id,
    ...(time === undefined ? {} : { time }),
    ...(subject === undefined ? {} : { subject }),
    data: dataIn(arrival, declared.data),
    ...(applies(arrival, declared.automatic) ? { automatic: true } : {}),
    ...actorIn(arrival, declared.actor),
  };
}

export function arrivalReadingOf(destination: Destination, arrival: Arrival): ArrivalReading {
  const handshake = handshakeIn(arrival, destination.handshake);
  const connection = connectionIn(arrival, destination.connection);
  const wake = wakeIn(arrival, destination.filter, connection?.account);
  const event = eventIn(arrival, destination.events);
  return {
    ...(handshake === undefined ? {} : { handshake }),
    ...(wake === undefined ? {} : { wake }),
    ...(connection === undefined ? {} : { connection }),
    ...(event === undefined ? {} : { event }),
  };
}
