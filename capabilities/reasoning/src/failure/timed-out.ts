import { Data } from 'effect';

export class TimedOut extends Data.TaggedError('timed_out')<{
  readonly detail: string;
  readonly provider: string;
  readonly timeout_ms: number;
}> {}
