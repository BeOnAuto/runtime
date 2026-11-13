import type { Conflict } from '@on.auto/operations';
import { Data } from 'effect';

export class StreamRefused extends Data.TaggedError('stream_refused')<{
  readonly stream: string;
  readonly conflict: Conflict;
}> {}
