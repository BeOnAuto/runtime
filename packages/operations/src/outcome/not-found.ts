import { Data } from 'effect';

export class NotFound extends Data.TaggedError('not_found')<{ readonly detail: string }> {}
