import { Effect } from 'effect';

import { aDataKey, zeroedAfter } from '../keepers/data-key.ts';
import type { KeepingFailure } from '../keepers/keeper.ts';
import { answeredWithinItsBound } from '../store/answer-bound.ts';
import type { Custodian } from './custodian.ts';

export function custodianProbed(custodian: Custodian): Effect.Effect<void, KeepingFailure> {
  return Effect.suspend(() => {
    const dataKey = aDataKey();
    const wrappedAndUnwrapped = Effect.flatMap(custodian.wrap(dataKey), (wrapped) =>
      Effect.flatMap(custodian.unwrap(wrapped), (unwrapped) => zeroedAfter(unwrapped, Effect.void)),
    );
    return zeroedAfter(dataKey, answeredWithinItsBound(wrappedAndUnwrapped));
  });
}
