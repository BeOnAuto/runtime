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

const noSecrets: readonly Redacted.Redacted[] = [];

function arrangedPerSubscription(destinations: readonly EventDestination[]): EventDestination | undefined {
  const webhook = destinations.find(({ type }) => type === 'webhook');
  return webhook?.per === 'subscription' ? webhook : undefined;
}

function secretIdsOf(subscriptions: readonly RecordedSubscription[], connection: string): readonly string[] {
  return subscriptions.flatMap(({ connection: through, made }) =>
    through === connection && made?.type === 'webhook' && made.secretId !== undefined ? [made.secretId] : [],
  );
}

function secretsHeldBy(
  { ledger, secrets }: SecretsReading,
  { connection, ...playbook }: DeliveredPlace,
): Effect.Effect<readonly Redacted.Redacted[]> {
  return Effect.flatMap(heldRowsOf(ledger, playbook), (rows) =>
    Effect.map(
      Effect.forEach(
        secretIdsOf(
          rows.map(({ row }) => recordedSubscriptionOf(row)),
          connection,
        ),
        (id) => subscriptionSecretIn(secrets, id),
      ),
      (kept: readonly (Redacted.Redacted | undefined)[]) => kept.filter((secret) => secret !== undefined),
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
): (place: DeliveredPlace, provenBy: ProvenBy) => Effect.Effect<readonly Redacted.Redacted[]> {
  return (place, provenBy) => (provenBy === 'subscription' ? secretsHeldBy(reading, place) : Effect.succeed(noSecrets));
}
