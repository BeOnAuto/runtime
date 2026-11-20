import type { PlaybookAddress, ProjectionReader } from '@on.auto/operations';
import type { EventDestination, RecordedSubscription } from '@on.auto/providers';
import { Effect, type Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { loopConnectionsOf, type LoopConnectionsParts } from './loop-connections.ts';
import { heldRowsOf } from './subscription-records.ts';
import { recordedSubscriptionOf } from './subscription-rows.ts';
import { subscriptionSecretIn } from './subscription-secrets.ts';

interface DeliveredPlace extends PlaybookAddress {
  readonly connection: string;
}

export type ProvenBy = NonNullable<EventDestination['verify']>['secret'];

interface SecretsReading {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'>;
  readonly secrets: Pick<SecretKeeping, 'read'>;
}

interface HeldSubscription {
  readonly topic: string;
  readonly id: string;
}

interface SecretOfASubscription {
  readonly subscription: HeldSubscription;
  readonly secret: Redacted.Redacted;
}

interface SecretIdOfASubscription {
  readonly subscription: HeldSubscription;
  readonly secretId: string;
}

const noSecrets: readonly SecretOfASubscription[] = [];

function arrangedPerSubscription(destinations: readonly EventDestination[]): EventDestination | undefined {
  const webhook = destinations.find(({ type }) => type === 'webhook');
  return webhook?.per === 'subscription' ? webhook : undefined;
}

function secretIdsOf(
  subscriptions: readonly RecordedSubscription[],
  connection: string,
): readonly SecretIdOfASubscription[] {
  return subscriptions.flatMap(({ connection: through, topic, made }) =>
    through === connection && made?.type === 'webhook' && made.secretId !== undefined
      ? [{ subscription: { topic, id: made.id }, secretId: made.secretId }]
      : [],
  );
}

function secretOf(
  secrets: SecretsReading['secrets'],
  { subscription, secretId }: SecretIdOfASubscription,
): Effect.Effect<readonly SecretOfASubscription[]> {
  return Effect.map(subscriptionSecretIn(secrets, secretId), (secret) =>
    secret === undefined ? [] : [{ subscription, secret }],
  );
}

function secretsHeldBy(
  { ledger, secrets }: SecretsReading,
  { connection, ...playbook }: DeliveredPlace,
): Effect.Effect<readonly SecretOfASubscription[]> {
  return Effect.flatMap(heldRowsOf(ledger, playbook), (rows) =>
    Effect.map(
      Effect.forEach(
        secretIdsOf(
          rows.map(({ row }) => recordedSubscriptionOf(row)),
          connection,
        ),
        (held) => secretOf(secrets, held),
      ),
      (kept: readonly (readonly SecretOfASubscription[])[]) => kept.flat(),
    ),
  );
}

export function deliveryDestinationOf(
  parts: LoopConnectionsParts,
): (place: DeliveredPlace) => Effect.Effect<EventDestination | undefined> {
  const connectionsOf = loopConnectionsOf(parts);
  return ({ connection, ...playbook }) =>
    Effect.map(connectionsOf(playbook), (connections) => {
      const named = connections.find((each) => each.connection === connection);
      return named === undefined ? undefined : arrangedPerSubscription(named.destinations);
    });
}

export function deliverySecretsOf(
  reading: SecretsReading,
): (place: DeliveredPlace, provenBy: ProvenBy) => Effect.Effect<readonly SecretOfASubscription[]> {
  return (place, provenBy) => (provenBy === 'subscription' ? secretsHeldBy(reading, place) : Effect.succeed(noSecrets));
}
