import { Data, Schema } from 'effect';

export const UnansweredKindSchema = Schema.Literals(['expired', 'undelivered']);

export type UnansweredKind = typeof UnansweredKindSchema.Type;

export class RunUnanswered extends Data.TaggedError('unanswered')<{
  readonly detail: string;
  readonly kind: UnansweredKind;
  readonly record?: Schema.JsonObject;
}> {}
