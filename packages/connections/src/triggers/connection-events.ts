import type { PlaybookAddress } from '@on.auto/operations';
import { isPolled, triggerTopicsOf, type EventDestination, type ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import {
  connectionsServingOf,
  loopConnectionOf,
  type LoopConnectionsParts,
} from '../subscriptions/loop-connections.ts';
import { arrangedPerSubscription } from '../subscriptions/subscription-deliveries.ts';

interface ConnectionPlace extends PlaybookAddress {
  readonly connection: string;
}

interface ReportedPlace {
  readonly type: string;
  readonly subject?: string;
}

interface ServedConnection {
  readonly topicsOf: (event: ReportedPlace) => Effect.Effect<readonly string[]>;
  readonly user?: string;
}

function topicsIn(destinations: readonly EventDestination[]): ServedConnection['topicsOf'] {
  return (event) =>
    Effect.map(
      Effect.forEach(destinations, (destination) => triggerTopicsOf(destination, event)),
      (topics: readonly (readonly (string | undefined)[])[]) =>
        topics.flat().filter((topic): topic is string => topic !== undefined),
    );
}

function placedIn(destinations: readonly EventDestination[]): readonly EventDestination[] {
  const arranged = arrangedPerSubscription(destinations);
  return [...(arranged === undefined ? [] : [arranged]), ...destinations.filter((each) => isPolled(each))];
}

function servedAs(providers: ProviderList, kept: KeptConnection): ServedConnection {
  const { destinations } = loopConnectionOf(providers, kept);
  const topicsOf = topicsIn(placedIn(destinations));
  return kept.identified === undefined ? { topicsOf } : { topicsOf, user: kept.identified.id };
}

function isConnectedAs({ connection }: KeptConnection, name: string): boolean {
  return connection.name === name && connection.status === 'connected';
}

export function servedConnectionOf(
  parts: LoopConnectionsParts,
): (place: ConnectionPlace) => Effect.Effect<ServedConnection | undefined> {
  const servingOf = connectionsServingOf(parts);
  return ({ connection, ...playbook }) =>
    Effect.map(servingOf(playbook), (serving) => {
      const named = serving.find((kept) => isConnectedAs(kept, connection));
      return named === undefined ? undefined : servedAs(parts.providers, named);
    });
}
