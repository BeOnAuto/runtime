import { PayloadDigestSchema } from '@on.auto/operations/payloads';
import { Schema } from 'effect';

export interface InlineValue {
  readonly value: Schema.Json;
  readonly bytes: number;
}

export interface KeptValue {
  readonly sha256: string;
  readonly bytes: number;
}

export type HeldValue = InlineValue | KeptValue;

export const HeldValueSchema: Schema.Codec<HeldValue> = Schema.Union([
  Schema.Struct({ value: Schema.Json, bytes: Schema.Int }),
  Schema.Struct({ sha256: PayloadDigestSchema, bytes: Schema.Int }),
]);
