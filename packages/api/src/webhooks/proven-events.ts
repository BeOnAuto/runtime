import { checkedProof, refusalAmong, type ProofCheck } from '@on.auto/identity';
import { arrivalReadingOf, presentedProofOf, type ArrivalReading } from '@on.auto/providers';
import { Result, type Redacted } from 'effect';

import { deliveryBodyOf } from './delivery-body.ts';
import { deliveryProblems } from './delivery-problems.ts';
import { arrivalOf } from './event-address.ts';
import type { DestinedDelivery, EventAddress, EventDoor, HeldSecret, Proven } from './event-ports.ts';
import { eventRead, handshakeAnswerOf, handshakeAnswered } from './read-events.ts';

type Proof = Proven | Exclude<ProofCheck, 'proven'>;

const noSecret: readonly Redacted.Redacted[] = [];

function namedIn(held: readonly HeldSecret[], { wake }: ArrivalReading): readonly HeldSecret[] {
  const named = wake?.subscription;
  return named === undefined ? held : held.filter(({ subscription }) => subscription?.id === named);
}

function secretsTriedFor(candidates: readonly HeldSecret[]): readonly (readonly Redacted.Redacted[])[] {
  return candidates.length === 0 ? [noSecret] : candidates.map(({ secret }) => [secret]);
}

function provenBy(verify: Proven['verify'], { secret, subscription }: HeldSecret, proving: number): Proven {
  return proving === 1 && subscription !== undefined ? { verify, secret, subscription } : { verify, secret };
}

async function proofOf(door: EventDoor, delivered: DestinedDelivery): Promise<Proof> {
  const { address, destination, arrival, body, reading } = delivered;
  const { verify } = destination;
  const presented = presentedProofOf(destination, arrival);
  if (presented === undefined || verify === undefined) {
    return 'unsigned';
  }
  const candidates = namedIn(await door.serving.secrets(address, verify.secret), reading);
  const received = { body, nowMs: door.now() };
  const checks = await Promise.all(
    secretsTriedFor(candidates).map((secrets) => checkedProof(verify, presented, secrets, received)),
  );
  const proving = candidates.filter((_, index) => checks[index] === 'proven');
  const [first] = proving;
  return first === undefined ? refusalAmong(checks) : provenBy(verify, first, proving.length);
}

async function destined(door: EventDoor, delivered: DestinedDelivery): Promise<Response> {
  const { destination, address, body, reading } = delivered;
  const { handshake } = destination;
  if (handshake?.signed === false && reading.handshake !== undefined) {
    return handshakeAnswered(door, delivered, handshakeAnswerOf(handshake, reading.handshake.challenge));
  }
  const proof = await proofOf(door, delivered);
  if (typeof proof === 'string') {
    return door.heard({ address, bytes: body.byteLength, outcome: proof }, deliveryProblems.unsigned());
  }
  return eventRead(door, delivered, proof);
}

export async function eventProven(door: EventDoor, request: Request, address: EventAddress): Promise<Response> {
  const body = await deliveryBodyOf(request, door.bounds);
  if (Result.isFailure(body)) {
    return door.heard({ address, bytes: 0, outcome: 'unread' }, deliveryProblems.of(body.failure));
  }
  const bytes = body.success;
  const destination = await door.serving.destination(address);
  if (destination === undefined) {
    return door.heard({ address, bytes: bytes.byteLength, outcome: 'unknown' }, deliveryProblems.unsigned());
  }
  const arrival = arrivalOf(request, bytes);
  const reading = arrivalReadingOf(destination, arrival);
  return destined(door, { address, body: bytes, destination, arrival, reading });
}
