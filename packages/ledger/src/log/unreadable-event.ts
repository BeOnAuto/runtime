import { Data } from 'effect';

import type { RecordedPoint } from '../event-store.ts';

export class UnreadableEvent extends Data.TaggedError('unreadable_event')<{
  readonly after: RecordedPoint | undefined;
}> {}

export function unreadableAfter(after: RecordedPoint | undefined): (error: unknown) => never {
  return (error) => {
    if (error instanceof SyntaxError) throw new UnreadableEvent({ after });
    throw error;
  };
}
