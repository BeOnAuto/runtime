import { Buffer } from 'node:buffer';

import type { Payload } from '@on.auto/operations/payloads';
import { Effect, type Schema } from 'effect';

export const mostInputBytes = 262_144;

export const mostResultBytes = 1_048_576;

export const mostInputDepth = 512;

export function nestsWithin(value: Schema.Json, levels: number): boolean {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  return levels > 0 && Object.values(value).every((item: Schema.Json) => nestsWithin(item, levels - 1));
}

export function jsonBytesOf(value: Schema.Json): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function payloadBytesOf(payload: Payload<Schema.Json>): number {
  return 'inline' in payload ? jsonBytesOf(payload.inline) : payload.kept.bytes;
}

export function withinResultLimit(...values: readonly Schema.Json[]): Effect.Effect<void> {
  return withinResultBytes(values.reduce((total: number, value) => total + jsonBytesOf(value), 0));
}

export function withinResultBytes(bytes: number): Effect.Effect<void> {
  return bytes <= mostResultBytes
    ? Effect.void
    : Effect.die(
        new Error(`The capability answered with ${bytes} bytes to record, more than the ${mostResultBytes} allowed`),
      );
}
