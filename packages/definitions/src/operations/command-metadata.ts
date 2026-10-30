import { Caller } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

export const commandMetadata = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});
