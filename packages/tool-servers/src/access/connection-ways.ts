import { Effect } from 'effect';

import { notAllowed } from '../names/tool-naming.ts';
import { isAllowed } from '../names/tool-reference.ts';
import { notOfferedOnce, type CalledOnce } from '../one-call/called-once.ts';
import type { OrgServer } from '../org-servers/org-servers.ts';
import type { LinkedAccess } from './linked-access.ts';

export interface ConnectionCall {
  readonly org: string;
  readonly connection: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type CallAsTheConnection = (call: ConnectionCall) => Effect.Effect<CalledOnce | undefined>;

export interface ConnectionWays {
  readonly callAsTheConnection: CallAsTheConnection;
}

type ServersOf = (org: string) => Effect.Effect<readonly OrgServer[]>;

function calledOn(
  server: OrgServer,
  { org, tool, input }: ConnectionCall,
  loaded: () => Promise<Pick<LinkedAccess, 'ownCallOnce'>>,
) {
  const reference = { server: server.settings.name, tool };
  return isAllowed(reference, server.settings.allowed)
    ? Effect.flatMap(Effect.promise(loaded), (linked) => linked.ownCallOnce({ org, reference, input }, server))
    : Effect.succeed(notOfferedOnce(notAllowed([reference])));
}

export function connectionWaysOf(
  serversOf: ServersOf,
  loaded: () => Promise<Pick<LinkedAccess, 'ownCallOnce'>>,
): ConnectionWays {
  return {
    callAsTheConnection: (call) =>
      Effect.flatMap(serversOf(call.org), (servers) => {
        const server = servers.find(({ settings }) => settings.connection === call.connection);
        return server === undefined ? Effect.undefined : calledOn(server, call, loaded);
      }),
  };
}
