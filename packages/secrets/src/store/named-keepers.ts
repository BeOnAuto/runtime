import { Effect, type Redacted } from 'effect';

import { keeperUnknown } from '../keepers/keeper-unavailable.ts';
import { keeperNamed, type Keeper, type Keepers, type ReadingFailure } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from './answer-bound.ts';

const leftBehind = 'A value no secret names any more is left where it was kept, until it is deleted there';

export function revealedBy(
  keepers: Keepers,
  holding: Holding,
): Effect.Effect<Redacted.Redacted | undefined, ReadingFailure> {
  const keeper = keeperNamed(keepers, holding.keptBy);
  return keeper === undefined
    ? Effect.fail(keeperUnknown(holding.keptBy))
    : answeredWithinItsBound(keeper.reveal(holding));
}

export function releasedOrLeft(keeper: Keeper | undefined, holding: Holding): Effect.Effect<void> {
  const releasing =
    keeper === undefined ? Effect.fail(keeperUnknown(holding.keptBy)) : answeredWithinItsBound(keeper.release(holding));
  return releasing.pipe(
    Effect.catch((failure: { readonly detail: string }) => Effect.logWarning(`${leftBehind}: ${failure.detail}`)),
  );
}

export function releasedBy(keepers: Keepers, holding: Holding): Effect.Effect<void> {
  return releasedOrLeft(keeperNamed(keepers, holding.keptBy), holding);
}
