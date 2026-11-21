import { hmacOf, type DeclaredProof } from '@on.auto/identity';
import {
  provesTheBody,
  provesTheBodyAndATime,
  provesWhatIsReadAt,
  type ArrivalReading,
  type EventDestination,
} from '@on.auto/providers';
import type { Redacted } from 'effect';

import { deliveryProblems } from './delivery-problems.ts';
import type { CarriedEvent, DestinedDelivery, EventDoor, Proven } from './event-ports.ts';

type Handshake = NonNullable<EventDestination['handshake']>;

type Answered = NonNullable<Handshake['response']>[string];

interface MacKey {
  readonly declared: DeclaredProof;
  readonly secret: Redacted.Redacted;
}

type HandshakeAnswer = Response | 'malformed' | 'unsigned';

const asText = { 'content-type': 'text/plain; charset=utf-8' };

function fieldOf(answered: Answered, challenge: string, key: MacKey | undefined): string | undefined {
  if (answered === 'challenge') {
    return challenge;
  }
  return key === undefined ? undefined : hmacOf(key.declared, key.secret, challenge);
}

export function handshakeAnswerOf(
  { response }: Handshake,
  challenge: string | undefined,
  key?: MacKey,
): HandshakeAnswer {
  if (challenge === undefined) {
    return 'malformed';
  }
  if (response === undefined) {
    return new Response(challenge, { status: 200, headers: asText });
  }
  const asked = Object.entries(response);
  const fields = asked.flatMap(([name, answered]: readonly [string, Answered]) => {
    const value = fieldOf(answered, challenge, key);
    return value === undefined ? [] : [[name, value] as const];
  });
  return fields.length === asked.length ? Response.json(Object.fromEntries(fields)) : 'unsigned';
}

export function handshakeAnswered(
  door: EventDoor,
  { address, body }: DestinedDelivery,
  answer: HandshakeAnswer,
): Response {
  const seen = { address, bytes: body.byteLength };
  return typeof answer === 'string'
    ? door.heard({ ...seen, outcome: answer }, deliveryProblems.unsigned())
    : door.heard({ ...seen, outcome: 'handshake' }, answer);
}

function macKeyOf({ when, challenge }: Handshake, { verify, secret }: Proven): MacKey | undefined {
  const readForTheCheck = [...Object.keys(when), challenge];
  return readForTheCheck.every((expression) => provesWhatIsReadAt(verify, expression))
    ? { declared: verify, secret }
    : undefined;
}

const handedOn = (): Response => new Response(null, { status: 200 });

function carriedIn({ event }: ArrivalReading, { verify, subscription }: Proven): CarriedEvent | undefined {
  return event === undefined || subscription === undefined || !provesTheBody(verify)
    ? undefined
    : { event, topic: subscription.topic };
}

export async function eventRead(door: EventDoor, delivered: DestinedDelivery, proven: Proven): Promise<Response> {
  const { address, destination, arrival, body, reading } = delivered;
  const seen = { address, bytes: body.byteLength };
  const { handshake } = destination;
  if (handshake !== undefined && reading.handshake !== undefined) {
    const answer = handshakeAnswerOf(handshake, reading.handshake.challenge, macKeyOf(handshake, proven));
    return handshakeAnswered(door, delivered, answer);
  }
  if (Object.keys(reading).length === 0) {
    return door.heard({ ...seen, outcome: 'passed_over' }, handedOn());
  }
  const { verify, subscription } = proven;
  const carried = carriedIn(reading, proven);
  await door.serving.arrived({
    address,
    reading,
    arrival,
    provesTheBodyAndATime: provesTheBodyAndATime(verify),
    ...(subscription === undefined ? {} : { subscription }),
    ...(carried === undefined ? {} : { carried }),
  });
  return door.heard({ ...seen, outcome: 'arrived' }, handedOn());
}
