import { Schema } from 'effect';

import { InstantSchema } from '../machine/instant.ts';
import { AdmissionRefusalSchema, type AdmissionRefusal } from './admission-refusal.ts';

export interface RefusedCalls {
  readonly since: number;
  readonly refusals: number;
  readonly waited: number;
  readonly refusal?: AdmissionRefusal;
}

const CountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const RefusedCallsSchema: Schema.Codec<RefusedCalls> = Schema.Struct({
  since: InstantSchema,
  refusals: CountSchema,
  waited: CountSchema,
  refusal: Schema.optionalKey(AdmissionRefusalSchema),
});
