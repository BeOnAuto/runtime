import { Schema } from 'effect';

import type { OlderFormat } from '../state-format.ts';
import { initialOfFormatSeven } from './format-seven.ts';

const ValuesHeldInlineSchema = Schema.Struct({
  machine: Schema.Struct({
    values: Schema.Record(
      Schema.String,
      Schema.Struct({ value: Schema.Unknown, sha256: Schema.optionalKey(Schema.Never) }),
    ),
  }),
});

const requireValuesHeldInline = Schema.decodeUnknownSync(ValuesHeldInlineSchema);

function heldInline(state: unknown): unknown {
  requireValuesHeldInline(state);
  return state;
}

export const formatEleven: OlderFormat = {
  format: 11,
  initial: initialOfFormatSeven,
  read: heldInline,
  upcast: (state) => state,
};
