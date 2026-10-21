import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import type { Holding } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from '../store/answer-bound.ts';
import type { SecretRefused } from '../store/secret-refused.ts';
import { KeeperUnavailable } from './keeper-unavailable.ts';
import type { Keeper, ReadingFailure } from './keeper.ts';

function readBack(keeper: Keeper, holding: Holding, written: string): Effect.Effect<void, ReadingFailure> {
  return Effect.flatMap(keeper.reveal(holding), (read) =>
    read !== undefined && Redacted.value(read) === written
      ? Effect.void
      : Effect.fail(
          new KeeperUnavailable({
            detail: `The keeper ${keeper.name} did not read back the value it had just held under ${holding.held}`,
          }),
        ),
  );
}

const probeIdPrefix = 'probe-';

export function keeperProbed(keeper: Keeper): Effect.Effect<void, ReadingFailure | SecretRefused> {
  return Effect.suspend(() => {
    const id = `${probeIdPrefix}${randomUUIDv7()}`;
    const written = randomUUIDv7();
    return answeredWithinItsBound(
      Effect.flatMap(keeper.hold(id, Redacted.make(written)), (holding) =>
        readBack(keeper, holding, written).pipe(
          Effect.onError(() => Effect.ignore(keeper.release(holding))),
          Effect.andThen(keeper.release(holding)),
        ),
      ),
    );
  });
}
