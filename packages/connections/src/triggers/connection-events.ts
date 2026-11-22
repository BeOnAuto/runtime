import type { PlaybookAddress } from '@on.auto/operations';
import { triggerTopicsOf, type EventDestination, type ProviderList } from '@on.auto/providers';
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

function topicsIn(destination: EventDestination | undefined): ServedConnection['topicsOf'] {
  return (event) =>
    destination === undefined
      ? Effect.succeed([])
      : Effect.map(triggerTopicsOf(destination, event), (topics) =>
          topics.filter((topic): topic is string => topic !== undefined),
        );
}

function servedAs(providers: ProviderList, kept: KeptConnection): ServedConnection {
  const { destinations } = loopConnectionOf(providers, kept);
  const topicsOf = topicsIn(arrangedPerSubscription(destinations));
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
