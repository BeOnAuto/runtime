import { Data, Schema } from 'effect';

export const CancelledKindSchema = Schema.Literals(['requested', 'deadline', 'overrun', 'parent_ended']);

export type CancelledKind = typeof CancelledKindSchema.Type;

export class RunCancelled extends Data.TaggedError('cancelled')<{
  readonly detail: string;
  readonly kind: CancelledKind;
  readonly record?: Schema.JsonObject;
}> {}
