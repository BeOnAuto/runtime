import type { PlaybookAddress } from '@on.auto/operations';
import { providerFoundBy, type ProviderEntry, type ProviderList } from '@on.auto/providers';
import type { ToolServer } from '@on.auto/tool-servers';
import { Effect, Function } from 'effect';

type ListServers = (playbook: PlaybookAddress, named: string) => Effect.Effect<readonly ToolServer[]>;

type DeclaredTypes = NonNullable<NonNullable<ProviderEntry['events']>['types']>;

interface Listened {
  readonly workflow: string;
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
}

type ListenedIn = (playbook: PlaybookAddress) => Effect.Effect<readonly Listened[]>;

interface ConnectionReported {
  readonly broken: boolean;
  readonly types: DeclaredTypes;
  readonly heard: () => undefined;
  readonly listenedBy: readonly Listened[];
}

export interface ConnectionsReporting {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReported | undefined>;
}

function isBroken(server: ToolServer): boolean {
  return 'because' in server && server.because === 'connection_broken';
}

function reportingOf(server: ToolServer, providers: ProviderList, listened: readonly Listened[]): ConnectionReported {
  return {
    broken: isBroken(server),
    types: providerFoundBy(providers, server.provider)?.entry.events?.types ?? [],
    heard: Function.constUndefined,
    listenedBy: listened.filter(({ connection }) => connection === server.name),
  };
}

export function connectionEventsOver(
  listServers: ListServers,
  providers: Effect.Effect<ProviderList>,
  listenedIn: ListenedIn,
): ConnectionsReporting {
  return {
    reportingOf: (playbook, connection) =>
      Effect.flatMap(listServers(playbook, connection), (servers) => {
        const server = servers.find((listed) => listed.name === connection && listed.connection !== undefined);
        return server === undefined
          ? Effect.undefined
          : Effect.zipWith(providers, listenedIn(playbook), (list, listened) => reportingOf(server, list, listened));
      }),
  };
}
