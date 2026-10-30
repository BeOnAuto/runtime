import { readDuration } from '@on.auto/workflow-engine/dsl';
import { Result } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';

const bounds = 'A request expires after a duration from one minute to thirty days, such as P2D or PT4H';

export function expiryOf(written: string): Result.Result<number, string> {
  const reading = readDuration(written);
  if ('problem' in reading) {
    return Result.fail(`${reading.problem}. ${bounds}`);
  }
  const { milliseconds } = reading;
  return milliseconds >= interactionBounds.shortestExpiryMs && milliseconds <= interactionBounds.longestExpiryMs
    ? Result.succeed(milliseconds)
    : Result.fail(`${written} is not a time a request may wait. ${bounds}`);
}
