import { valueAt } from '@on.auto/definitions/tool-blocks';
import type { Schema } from 'effect';

import type { Destination } from './destination-fields.ts';
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

export interface ArrivalReading {
  readonly handshake?: ArrivalHandshake;
  readonly wake?: ArrivalWake;
  readonly connection?: ArrivalConnection;
}

export interface PresentedProof {
  readonly signature?: string;
  readonly timestamp?: string | number;
  readonly id?: string;
  readonly token?: string;
  readonly header?: (name: string) => string | undefined;
}

type Conditions = Readonly<Record<string, readonly string[]>>;

type DeclaredReply = NonNullable<Destination['filter']['reply']>;

type Proof = NonNullable<Destination['verify']>;

type ProofPart = 'signature' | 'timestamp' | 'id' | 'token';

const proofParts: readonly ProofPart[] = ['signature', 'timestamp', 'id', 'token'];

function headerIn(headers: Readonly<Record<string, string>>, name: string): string | undefined {
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

function declaredValueIn(arrival: Arrival, expression: string | undefined): unknown {
  return expression === undefined ? undefined : valueIn(arrival, expression);
}

function textIn(arrival: Arrival, expression: string | undefined): string | undefined {
  const value = declaredValueIn(arrival, expression);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function holdsSomething(arrival: Arrival, expression: string | undefined): boolean {
  return (declaredValueIn(arrival, expression) ?? null) !== null;
}

function holds(arrival: Arrival, when: Conditions): boolean {
  const conditions = Object.entries(when);
  return (
    conditions.length > 0 &&
    conditions.every(([expression, values]: readonly [string, readonly string[]]) => {
      const value = valueIn(arrival, expression);
      return typeof value === 'string' && values.includes(value);
    })
  );
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

function sendingTimeIn(arrival: Arrival, expression: string | undefined): string | number | undefined {
  const value = declaredValueIn(arrival, expression);
  return typeof value === 'number' || (typeof value === 'string' && value !== '') ? value : undefined;
}

function proofPartsIn(arrival: Arrival, verify: Proof): Pick<PresentedProof, ProofPart> {
  const signature = textIn(arrival, verify.signature);
  const timestamp = sendingTimeIn(arrival, verify.timestamp);
  const id = textIn(arrival, verify.id);
  const token = textIn(arrival, verify.token);
  return {
    ...(signature === undefined ? {} : { signature }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(id === undefined ? {} : { id }),
    ...(token === undefined ? {} : { token }),
  };
}

export function presentedProofOf({ verify }: Destination, arrival: Arrival): PresentedProof | undefined {
  if (verify === undefined || arrival.transport !== 'request') {
    return undefined;
  }
  const parts = proofPartsIn(arrival, verify);
  if (proofParts.some((part) => verify[part] !== undefined && parts[part] === undefined)) {
    return undefined;
  }
  const { headers } = arrival;
  return verify.scheme === 'standard-webhooks' ? { ...parts, header: (name) => headerIn(headers, name) } : parts;
}

export function arrivalReadingOf(destination: Destination, arrival: Arrival): ArrivalReading {
  const handshake = handshakeIn(arrival, destination.handshake);
  const connection = connectionIn(arrival, destination.connection);
  const wake = wakeIn(arrival, destination.filter, connection?.account);
  return {
    ...(handshake === undefined ? {} : { handshake }),
    ...(wake === undefined ? {} : { wake }),
    ...(connection === undefined ? {} : { connection }),
  };
}
