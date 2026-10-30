import { Data, Effect } from 'effect';

export class InvalidSettingsError extends Data.TaggedError('InvalidSettingsError')<{ readonly message: string }> {}

export function asInvalidSettings<A>(
  parsing: Effect.Effect<A, { readonly message: string }>,
): Effect.Effect<A, InvalidSettingsError> {
  return parsing.pipe(Effect.mapError(({ message }) => new InvalidSettingsError({ message })));
}
