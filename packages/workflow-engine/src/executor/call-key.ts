import { Schema } from 'effect';

export const CallKeySchema = Schema.Struct({
  runId: Schema.NonEmptyString,
  reference: Schema.String,
  run: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export type CallKey = typeof CallKeySchema.Type;

export function callKeyText({ runId, reference, run }: CallKey): string {
  return JSON.stringify([runId, reference, run]);
}
