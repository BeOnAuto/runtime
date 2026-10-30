import { Data } from 'effect';

export class StartRejected extends Data.TaggedError('start_rejected')<{ readonly detail: string }> {}
