import { madeSigningSecret } from '@on.auto/identity';
import type { SubscriptionSecrets } from '@on.auto/providers';
import { Effect, type Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';

export function subscriptionSecretIn(
  secrets: Pick<SecretKeeping, 'read'>,
  id: string,
): Effect.Effect<Redacted.Redacted | undefined> {
  return Effect.map(Effect.orDie(secrets.read(id)), (kept) => kept?.value);
}

export function subscriptionSecretsOf(secrets: Pick<SecretKeeping, 'keep' | 'read' | 'forget'>): SubscriptionSecrets {
  return {
    make: () =>
      Effect.suspend(() => {
        const secret = madeSigningSecret();
        return Effect.map(Effect.orDie(secrets.keep(secret)), (id) => ({ id, secret }));
      }),
    keep: (_place, secret) => Effect.orDie(secrets.keep(secret)),
    read: (_place, id) => subscriptionSecretIn(secrets, id),
    forget: (_place, id) => secrets.forget(id),
  };
}
