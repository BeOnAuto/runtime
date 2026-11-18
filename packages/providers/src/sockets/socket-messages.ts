import { JsonPointer, Option, Schema } from 'effect';

import { valueIn, type Arrival } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';
import { messageReferenceOf } from '../events/runtime-expressions.ts';

const jsonIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

export function messageArrivalOf(text: string): Arrival | undefined {
  return Option.getOrUndefined(Option.map(jsonIn(text), (payload): Arrival => ({ transport: 'message', payload })));
}

type Identity = string | number;

function isAnIdentity(value: unknown): value is Identity {
  return (typeof value === 'string' && value !== '') || typeof value === 'number';
}

function placedAt(pointer: string, identity: Identity): Schema.Json {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => JsonPointer.unescapeToken(token))
    .reduceRight<Schema.Json>((inner, token) => ({ [token]: inner }), identity);
}

export function acknowledgementOf({ acknowledge }: Destination, arrival: Arrival): string | undefined {
  if (acknowledge === undefined) {
    return undefined;
  }
  const reference = messageReferenceOf(acknowledge);
  const identity = valueIn(arrival, acknowledge);
  return reference !== undefined && isAnIdentity(identity)
    ? JSON.stringify(placedAt(reference.pointer, identity))
    : undefined;
}
