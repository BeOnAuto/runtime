import { Effect, Option, Redacted, Ref } from 'effect';

import type { KeptSecret, MadeSubscription, SubscriptionPlace, SubscriptionSecrets } from './subscription-ports.ts';

export interface SecretToPlace {
  readonly madeSecret: Effect.Effect<Redacted.Redacted>;
  readonly made: Effect.Effect<Option.Option<KeptSecret>>;
}

export function secretToPlace(
  secrets: SubscriptionSecrets,
  place: SubscriptionPlace,
  held: MadeSubscription | undefined,
): Effect.Effect<SecretToPlace> {
  return Effect.gen(function* () {
    const made = yield* Ref.make(Option.none<KeptSecret>());
    const madeSecret = Effect.gen(function* () {
      const reused = held?.secretId === undefined ? undefined : yield* secrets.read(place, held.secretId);
      if (reused !== undefined) {
        return reused;
      }
      const kept = yield* secrets.make(place);
      yield* Ref.set(made, Option.some(kept));
      return kept.secret;
    });
    return { madeSecret, made: Ref.get(made) };
  });
}

export function answeredSecretId(
  secrets: SubscriptionSecrets,
  place: SubscriptionPlace,
  answered: Redacted.Redacted,
  held: MadeSubscription | undefined,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const heldId = held?.secretId;
    if (heldId !== undefined) {
      const before = yield* secrets.read(place, heldId);
      if (before !== undefined && Redacted.value(before) === Redacted.value(answered)) {
        return heldId;
      }
    }
    return yield* secrets.keep(place, answered);
  });
}
