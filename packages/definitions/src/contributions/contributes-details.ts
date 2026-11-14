import { Option, Schema } from 'effect';

import { ContributesSchema } from '../goals/goals-document.ts';

export type Contributes = typeof ContributesSchema.Type;

const decodedContributes = Schema.decodeUnknownOption(ContributesSchema);

export function contributesIn(details?: Schema.JsonObject): Contributes | undefined {
  return Option.getOrUndefined(decodedContributes(details?.['contributes']));
}
