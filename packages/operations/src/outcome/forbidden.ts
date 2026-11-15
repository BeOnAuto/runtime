import { Data, Schema } from 'effect';

export const ForbiddenKindSchema = Schema.Literal('permission_denied');

export type ForbiddenKind = typeof ForbiddenKindSchema.Type;

export class Forbidden extends Data.TaggedError('forbidden')<{ readonly detail: string }> {}
