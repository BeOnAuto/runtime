import { checkedProof, type ProofCheck } from '@on.auto/identity';
import { arrivalReadingOf, presentedProofOf } from '@on.auto/providers';
import { Result } from 'effect';

import { deliveryBodyOf } from './delivery-body.ts';
import { deliveryProblems } from './delivery-problems.ts';
import { arrivalOf } from './event-address.ts';
import type { DestinedDelivery, EventAddress, EventDoor, Proven } from './event-ports.ts';
import { eventRead, handshakeAnswerOf, handshakeAnswered } from './read-events.ts';

type Proof = Proven | Exclude<ProofCheck, 'proven'>;

async function proofOf(door: EventDoor, { address, destination, arrival, body }: DestinedDelivery): Promise<Proof> {
  const { verify } = destination;
  const presented = presentedProofOf(destination, arrival);
  if (presented === undefined || verify === undefined) {
    return 'unsigned';
  }
  const secrets = await door.serving.secrets(address, verify.secret);
  const received = { body, nowMs: door.now() };
  const check = await checkedProof(verify, presented, secrets, received);
  return check === 'proven' ? { verify, presented, secrets, received } : check;
}

async function destined(door: EventDoor, delivered: DestinedDelivery): Promise<Response> {
  const { destination, arrival, address, body } = delivered;
  const { handshake } = destination;
  const before = handshake?.signed === false ? arrivalReadingOf(destination, arrival).handshake : undefined;
  if (handshake !== undefined && before !== undefined) {
    return handshakeAnswered(door, delivered, handshakeAnswerOf(handshake, before.challenge));
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
  return destined(door, { address, body: bytes, destination, arrival: arrivalOf(request, bytes) });
}
