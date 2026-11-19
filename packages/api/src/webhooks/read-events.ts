import { checkedProof, hmacOf, type DeclaredProof } from '@on.auto/identity';
import { arrivalReadingOf, provesTheBodyAndATime, provesWhatIsReadAt, type EventDestination } from '@on.auto/providers';
import type { Redacted } from 'effect';

import { deliveryProblems } from './delivery-problems.ts';
import type { DestinedDelivery, EventDoor, Proven } from './event-ports.ts';

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

async function macKeyOf({ when, challenge }: Handshake, proven: Proven): Promise<MacKey | undefined> {
  const { verify, presented, secrets, received } = proven;
  const readForTheCheck = [...Object.keys(when), challenge];
  if (!readForTheCheck.every((expression) => provesWhatIsReadAt(verify, expression))) {
    return undefined;
  }
  const checks = await Promise.all(secrets.map((secret) => checkedProof(verify, presented, [secret], received)));
  return secrets.filter((_, index) => checks[index] === 'proven').map((secret) => ({ declared: verify, secret }))[0];
}

const handedOn = (): Response => new Response(null, { status: 200 });

export async function eventRead(door: EventDoor, delivered: DestinedDelivery, proven: Proven): Promise<Response> {
  const { address, destination, arrival, body } = delivered;
  const seen = { address, bytes: body.byteLength };
  const reading = arrivalReadingOf(destination, arrival);
  const { handshake } = destination;
  if (handshake !== undefined && reading.handshake !== undefined) {
    const answer = handshakeAnswerOf(handshake, reading.handshake.challenge, await macKeyOf(handshake, proven));
    return handshakeAnswered(door, delivered, answer);
  }
  if (Object.keys(reading).length === 0) {
    return door.heard({ ...seen, outcome: 'passed_over' }, handedOn());
  }
  await door.serving.arrived({
    address,
    reading,
    arrival,
    provesTheBodyAndATime: provesTheBodyAndATime(proven.verify),
  });
  return door.heard({ ...seen, outcome: 'arrived' }, handedOn());
}
