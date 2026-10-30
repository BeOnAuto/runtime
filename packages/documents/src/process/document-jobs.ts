import type { ProcessHandlers } from '@on.auto/workflow-engine/process-loop';
import { Schema } from 'effect';

import { textWithin } from '../reading/text-within.ts';

const BytesSchema = Schema.declare((value: unknown): value is Readonly<Uint8Array> => value instanceof Uint8Array);

const GivenSchema = Schema.Struct({
  bytes: BytesSchema,
  mediaType: Schema.String,
  name: Schema.NullOr(Schema.String),
  textBytes: Schema.Number,
});

const decodeGiven = Schema.decodeUnknownSync(GivenSchema);

export const documentJobKind = 'text';

export function documentJobs(): ProcessHandlers {
  return {
    [documentJobKind]: (payload) => {
      const { bytes, mediaType, name, textBytes } = decodeGiven(payload);
      return textWithin({ bytes, mediaType, name: name ?? undefined }, textBytes);
    },
  };
}
