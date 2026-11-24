import { Schema } from 'effect';

import {
  applies,
  declaredValueIn,
  holds,
  holdsSomething,
  textIn,
  valueIn,
  type Arrival,
  type Conditions,
} from './arrival-values.ts';
import type { Destination } from './destination-fields.ts';
import { eventTimeOf } from './event-times.ts';

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

interface DeliveredClick {
  readonly account: string;
  readonly id: string;
  readonly sender: string;
  readonly to: string;
  readonly action: string;
  readonly time?: string | number;
}

interface ArrivalWake {
  readonly subscription?: string;
  readonly conversation?: string;
  readonly reply?: DeliveredReply;
  readonly click?: DeliveredClick;
}

interface ArrivalConnection {
  readonly account?: string;
  readonly user?: string;
}

export interface ArrivalEvent {
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

type Filter = NonNullable<Destination['filter']>;

type DeclaredReply = NonNullable<Filter['reply']>;

type DeclaredClick = NonNullable<Filter['click']>;

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

function clickAccountIn(arrival: Arrival, click: DeclaredClick | undefined): string | undefined {
  return click === undefined || !holds(arrival, click.when) ? undefined : textIn(arrival, click.account);
}

function clickIn(arrival: Arrival, click: DeclaredClick, account: string | undefined): ArrivalWake | undefined {
  if (account === undefined || !holds(arrival, click.when)) {
    return undefined;
  }
  const conversation = textIn(arrival, click.conversation);
  const id = textIn(arrival, click.id);
  const sender = textIn(arrival, click.sender);
  const to = textIn(arrival, click.to);
  const action = textIn(arrival, click.action);
  if (conversation === undefined || id === undefined || sender === undefined || to === undefined) {
    return undefined;
  }
  return action === undefined
    ? undefined
    : { conversation, click: { account, id, sender, to, action, ...timeIn(arrival, click.time) } };
}

function namedIn(arrival: Arrival, filter: Filter): Omit<ArrivalWake, 'reply'> {
  const subscription = textIn(arrival, filter.subscription);
  const conversation = textIn(arrival, filter.conversation);
  return {
    ...(subscription === undefined ? {} : { subscription }),
    ...(conversation === undefined ? {} : { conversation }),
  };
}

function wakeIn(arrival: Arrival, filter: Filter | undefined, account: string | undefined): ArrivalWake | undefined {
  const clicked = filter?.click === undefined ? undefined : clickIn(arrival, filter.click, account);
  if (clicked !== undefined) {
    return clicked;
  }
  if (filter === undefined || !holds(arrival, filter.when) || holdsSomething(arrival, filter.automatic)) {
    return undefined;
  }
  const named = namedIn(arrival, filter);
  const reply =
    named.conversation === undefined || filter.reply === undefined
      ? undefined
      : replyIn(arrival, filter.reply, account);
  return reply === undefined ? named : { ...named, reply };
}

function connectionIn(
  arrival: Arrival,
  connection: Destination['connection'],
  clicked: string | undefined,
): ArrivalConnection | undefined {
  const account = textIn(arrival, connection?.account) ?? clicked;
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

type Holding = (arrival: Arrival, when: Conditions) => boolean;

function holdsOrListsEveryItem(arrival: Arrival, when: Conditions): boolean {
  return Object.keys(when).length === 0 || holds(arrival, when);
}

function matchedIn(arrival: Arrival, mappings: readonly DeclaredEvent[], holding: Holding): Matched | undefined {
  return mappings.flatMap((declared): readonly Matched[] => {
    const id = holding(arrival, declared.when) ? idIn(arrival, declared.id) : undefined;
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

export function isItsOwn(arrival: Arrival, own: readonly [string, string] | undefined): boolean {
  if (own === undefined) {
    return false;
  }
  const [doneBy, actingAs] = own;
  const account = textIn(arrival, doneBy);
  return account !== undefined && account === textIn(arrival, actingAs);
}

function eventIn(arrival: Arrival, mappings: Destination['events'], holding: Holding): ArrivalEvent | undefined {
  const matched = matchedIn(arrival, mappings ?? [], holding);
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
  const connection = connectionIn(arrival, destination.connection, clickAccountIn(arrival, destination.filter?.click));
  const wake = wakeIn(arrival, destination.filter, connection?.account);
  const event = eventIn(arrival, destination.events, holds);
  return {
    ...(handshake === undefined ? {} : { handshake }),
    ...(wake === undefined ? {} : { wake }),
    ...(connection === undefined ? {} : { connection }),
    ...(event === undefined ? {} : { event }),
  };
}

export function listedEventOf({ events }: Pick<Destination, 'events'>, item: Schema.Json): ArrivalEvent | undefined {
  const event = eventIn({ transport: 'message', payload: item }, events, holdsOrListsEveryItem);
  return event === undefined ? undefined : { ...event, id: `${encodeURIComponent(event.type)}/${event.id}` };
}

export function listedValueIn(item: Schema.Json, expression: string): unknown {
  return valueIn({ transport: 'message', payload: item }, expression);
}
