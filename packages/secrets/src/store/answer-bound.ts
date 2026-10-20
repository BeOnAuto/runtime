import { Duration, Effect } from 'effect';

import { keeperUnavailable, type KeeperUnavailable } from '../keepers/keeper-unavailable.ts';

const answerBoundSeconds = 30;

const answerBound = Duration.seconds(answerBoundSeconds);

export function answeredWithinItsBound<A, E>(asked: Effect.Effect<A, E>): Effect.Effect<A, E | KeeperUnavailable> {
  return Effect.timeoutOrElse(asked, {
    duration: answerBound,
    orElse: () => Effect.fail(keeperUnavailable(answerBoundSeconds)),
  });
}
