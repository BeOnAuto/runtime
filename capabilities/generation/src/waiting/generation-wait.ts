import { factOf, RunContextSchema } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { madeByFields } from '../assets/asset-facts.ts';
import { mostHandleCharacters } from '../gateway/gateway-answers.ts';

const HandleSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostHandleCharacters));

const WaitSchema = Schema.Struct({
  ...madeByFields,
  handle: HandleSchema,
  kept_for_ms: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  asked_at: Schema.String,
  waits_until: Schema.String,
});

export type GenerationWait = typeof WaitSchema.Type;

export const GenerationDeferredSchema = factOf('run_deferred', Schema.Struct({ record: WaitSchema }), RunContextSchema);

const decodeWait = Schema.decodeUnknownOption(WaitSchema);

export function generationWaitOf(record: unknown): GenerationWait | undefined {
  return Option.getOrUndefined(decodeWait(record));
}

export const generationWaitFrom: (record: unknown) => GenerationWait = Schema.decodeUnknownSync(WaitSchema);

export function gatewayNameOf(model: string): string {
  return model.slice(0, model.indexOf('/'));
}
