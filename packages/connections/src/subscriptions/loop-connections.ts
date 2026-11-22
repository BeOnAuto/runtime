import type { PlaybookAddress, StreamReader } from '@on.auto/operations';
import { EventsByHandSchema, providerFoundBy, type LoopConnection, type ProviderList } from '@on.auto/providers';
import { Effect, Option, Schema } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import { connectionsFoldOf, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { holdsItUnrefused } from '../sockets/socket-holders.ts';

export interface LoopConnectionsParts {
  readonly registry: Pick<StreamReader, 'load'>;
  readonly providers: ProviderList;
}

function servesThePlaybook({ status, entry }: RecordedConnection, { playbook }: PlaybookAddress): boolean {
  return status !== 'removed' && (entry.playbooks === undefined || entry.playbooks.includes(playbook));
}

type Destinations = LoopConnection['destinations'];

function takenThrough(connection: RecordedConnection, destinations: Destinations): Destinations {
  return destinations.filter(
    ({ type, credential }) =>
      type !== 'websocket' || (credential !== undefined && holdsItUnrefused(connection, credential)),
  );
}

const asGivenByHand = Schema.decodeUnknownOption(EventsByHandSchema);

function declaredFor(providers: ProviderList, { provider, events }: RecordedConnection): Destinations {
  const entry = providerFoundBy(providers, provider)?.entry;
  if (entry !== undefined) {
    return entry.events?.destinations ?? [];
  }
  return Option.match(asGivenByHand(events), { onNone: () => [], onSome: ({ destinations }) => destinations });
}

function identityOwedBy(
  providers: ProviderList,
  { connection, identified }: KeptConnection,
): Pick<LoopConnection, 'identify'> {
  const identity = providerFoundBy(providers, connection.provider)?.entry.events?.identity;
  return identity === undefined || identified !== undefined || connection.status !== 'connected'
    ? {}
    : { identify: identity };
}

export function loopConnectionOf(providers: ProviderList, kept: KeptConnection): LoopConnection {
  const { connection } = kept;
  const { id, name, connected_at: connectedAt, account } = connection;
  const destinations = takenThrough(connection, declaredFor(providers, connection));
  return {
    id,
    connection: name,
    ...(connectedAt === null ? {} : { connected: connectedAt }),
    ...(account === null ? {} : { account: account.id }),
    destinations,
    ...identityOwedBy(providers, kept),
  };
}

export function connectionsServingOf({
  registry,
  providers,
}: LoopConnectionsParts): (playbook: PlaybookAddress) => Effect.Effect<readonly KeptConnection[]> {
  const fold = connectionsFoldOf(providers);
  return (playbook) =>
    Effect.map(registry.load(connectionsStreamOfOrg(playbook.org), fold), ({ state }) =>
      [...state.values()].filter(({ connection }) => servesThePlaybook(connection, playbook)),
    );
}

export function loopConnectionsOf(
  parts: LoopConnectionsParts,
): (playbook: PlaybookAddress) => Effect.Effect<readonly LoopConnection[]> {
  const servingOf = connectionsServingOf(parts);
  return (playbook) =>
    Effect.map(servingOf(playbook), (serving) => serving.map((kept) => loopConnectionOf(parts.providers, kept)));
}
