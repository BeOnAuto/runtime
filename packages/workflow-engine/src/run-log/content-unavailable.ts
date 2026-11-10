import { Data } from 'effect';

export class ContentUnavailable extends Data.TaggedError('content_unavailable')<{ readonly detail: string }> {}
