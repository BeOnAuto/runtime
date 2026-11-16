import { Schema } from 'effect';

function plainOf(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { bigint: value.toString() };
  }
  if (value instanceof Date) {
    return { date: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { bytes: Buffer.from(value).toString('hex') };
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => plainOf(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: readonly [string, unknown]) => [key, plainOf(item)]),
    );
  }
  return value;
}

export function canonicalJsonOf(value: unknown): string {
  return JSON.stringify(plainOf(value));
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

export function plainJsonOf(value: unknown): Schema.Json {
  return decodeJson(canonicalJsonOf(value));
}
