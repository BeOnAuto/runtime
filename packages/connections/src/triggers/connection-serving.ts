import type { PlaybookAddress, ProjectionReader, StreamReader } from '@on.auto/operations';
import {
  providerFoundBy,
  triggerTopicsOf,
  type EventDestination,
  type ProviderEntry,
  type ProviderList,
} from '@on.auto/providers';
import { Effect } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import { replacedOf } from '../replacements/replaced-providers.ts';
import { connectionsServingOf } from '../subscriptions/loop-connections.ts';
import { hearingOf, type EventsReceived, type Hearing } from './connection-hearing.ts';
import type { ListServers } from './connection-tools.ts';
import type { ConnectionAsRecorded } from './trigger-standing.ts';

export interface ConnectionEventsParts {
  readonly registry: Pick<StreamReader, 'load'>;
  readonly providers: Effect.Effect<ProviderList>;
  readonly subscriptions: Pick<ProjectionReader, 'readProjectedRows'>;
  readonly received: EventsReceived;
  readonly listServers?: ListServers;
}

export interface Serving {
  readonly kept: KeptConnection;
  readonly entry: ProviderEntry | undefined;
}

export const notHeard: Hearing = { kind: 'not_heard' };

export function servingNamed(
  { registry }: ConnectionEventsParts,
  providers: ProviderList,
  playbook: PlaybookAddress,
  connection: string,
): Effect.Effect<Serving | undefined> {
  return Effect.map(connectionsServingOf({ registry, providers })(playbook), (serving) => {
    const kept = serving.find((each) => each.connection.name === connection);
    return kept === undefined
      ? undefined
      : { kept, entry: providerFoundBy(providers, kept.connection.provider)?.entry };
  });
}

export function statusOf({ connection }: KeptConnection, providers: ProviderList): ConnectionAsRecorded['status'] {
  if (connection.status === 'pending') {
    return 'pending';
  }
  return connection.status === 'connected' && replacedOf(providers, connection.provider) === undefined
    ? 'connected'
    : 'broken';
}

export function hearingIn({ kept, entry }: Serving, received: EventsReceived, type: string): Hearing {
  return entry === undefined ? notHeard : hearingOf(kept.connection, entry, received, type);
}

export function topicOf(
  destination: EventDestination,
  asked: { readonly type: string; readonly subject?: string },
): Effect.Effect<string | undefined> {
  return Effect.map(triggerTopicsOf(destination, asked), (topics) => topics.find((topic) => topic !== undefined));
}
