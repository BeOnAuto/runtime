import { RejectionBecauseSchema } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { AccountRefused, type FailedAttempt } from './transcription.ts';

const AccountRefusalSchema = Schema.Struct({
  error: Schema.Struct({
    type: Schema.Literals(['credits_exhausted', 'account_closed', 'meter_unavailable', 'model_not_offered']),
    message: Schema.String,
    resolve_at: Schema.optionalKey(Schema.String),
    because: Schema.optionalKey(Schema.String),
  }),
});

const accountRefusalOf = Schema.decodeUnknownOption(AccountRefusalSchema);

const isBecause = Schema.is(RejectionBecauseSchema);

export function refusedByTheAccount(data: unknown): FailedAttempt | undefined {
  const refusal = accountRefusalOf(data);
  if (Option.isNone(refusal)) {
    return undefined;
  }
  const { type: kind, message: detail, resolve_at: resolveAt, because } = refusal.value.error;
  return {
    failed: Effect.fail(
      new AccountRefused({
        kind,
        detail,
        ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
        ...(isBecause(because) ? { because } : {}),
      }),
    ),
    retryable: false,
    retryAfterMs: null,
  };
}
