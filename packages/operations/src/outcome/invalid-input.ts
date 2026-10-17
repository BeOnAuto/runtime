import { Data, Schema } from 'effect';

import type { Issue } from './issue.ts';

export const InvalidInputKindSchema = Schema.Literal('input_schema');

export type InvalidInputKind = typeof InvalidInputKindSchema.Type;

export class InvalidInput extends Data.TaggedError('invalid_input')<{
  readonly detail: string;
  readonly issues: readonly Issue[];
  readonly kind?: InvalidInputKind;
  readonly record?: Schema.JsonObject;
}> {}
