import { Data, Schema } from 'effect';

export const ForbiddenKindSchema = Schema.Literals(['permission_denied', 'not_allowed_token_type']);

export type ForbiddenKind = typeof ForbiddenKindSchema.Type;

export class Forbidden extends Data.TaggedError('forbidden')<{ readonly detail: string }> {}
