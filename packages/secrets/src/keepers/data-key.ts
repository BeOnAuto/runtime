import { Effect, Redacted } from 'effect';

const dataKeyBytes = 32;

export function aDataKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(crypto.getRandomValues(new Uint8Array(dataKeyBytes)));
}

export function zeroedAfter<A, E>(
  dataKey: Redacted.Redacted<Uint8Array>,
  use: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.ensuring(
    use,
    Effect.sync(() => {
      Redacted.value(dataKey).fill(0);
    }),
  );
}
