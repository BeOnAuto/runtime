import type { Digested } from '@on.auto/content';
import { CallResultSchema, type CallResult } from '@on.auto/operations';
import { PayloadBytesSchema, PayloadDigestSchema } from '@on.auto/operations/payloads';
import { Schema } from 'effect';

export const KeptCallResultSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output_sha256: PayloadDigestSchema,
  output_bytes: PayloadBytesSchema,
});

export const CallAnsweredResultSchema = Schema.Union([CallResultSchema, KeptCallResultSchema]);

export type KeptCallResult = typeof KeptCallResultSchema.Type;

export type CallAnsweredResult = CallResult | KeptCallResult;

export function keptOutputOf(result: CallAnsweredResult): Digested | undefined {
  return 'output_sha256' in result ? { sha256: result.output_sha256, bytes: result.output_bytes } : undefined;
}

export function keptCallResultOf({ sha256, bytes }: Digested): KeptCallResult {
  return { status: 'succeeded', output_sha256: sha256, output_bytes: bytes };
}
