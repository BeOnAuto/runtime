import { Data } from 'effect';

export class Forbidden extends Data.TaggedError('forbidden')<{ readonly detail: string }> {}
