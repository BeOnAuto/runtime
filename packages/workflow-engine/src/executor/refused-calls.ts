import { Schema } from 'effect';

import { InstantSchema } from '../machine/instant.ts';

export interface RefusedCalls {
  readonly since: number;
  readonly refusals: number;
  readonly waited: number;
}

const CountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const RefusedCallsSchema: Schema.Codec<RefusedCalls> = Schema.Struct({
  since: InstantSchema,
  refusals: CountSchema,
  waited: CountSchema,
});
