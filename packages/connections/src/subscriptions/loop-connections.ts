import type { PlaybookAddress, StreamReader } from '@on.auto/operations';
import { providerFoundBy, type LoopConnection, type ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import { connectionsFoldOf, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
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

function loopConnectionOf(providers: ProviderList, connection: RecordedConnection): LoopConnection {
  const { name, provider, connected_at: connectedAt } = connection;
  const destinations = takenThrough(connection, providerFoundBy(providers, provider)?.entry.events?.destinations ?? []);
  return connectedAt === null
    ? { connection: name, destinations }
    : { connection: name, connected: connectedAt, destinations };
}

export function loopConnectionsOf({
  registry,
  providers,
}: LoopConnectionsParts): (playbook: PlaybookAddress) => Effect.Effect<readonly LoopConnection[]> {
  const fold = connectionsFoldOf(providers);
  return (playbook) =>
    Effect.map(registry.load(connectionsStreamOfOrg(playbook.org), fold), ({ state }) =>
      [...state.values()]
        .filter(({ connection }) => servesThePlaybook(connection, playbook))
        .map(({ connection }) => loopConnectionOf(providers, connection)),
    );
}
