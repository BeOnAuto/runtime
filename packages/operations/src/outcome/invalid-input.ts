import { Data, Schema } from 'effect';

import type { Issue } from './issue.ts';

export const InvalidInputKindSchema = Schema.Literals(['input_schema', 'cursor_not_held']);

export type InvalidInputKind = typeof InvalidInputKindSchema.Type;

export class InvalidInput extends Data.TaggedError('invalid_input')<{
  readonly detail: string;
  readonly issues: readonly Issue[];
  readonly kind?: InvalidInputKind;
  readonly record?: Schema.JsonObject;
}> {}
