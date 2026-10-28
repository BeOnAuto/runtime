import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option, type Result } from 'effect';

import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Load, OrgAccess } from '../org-servers/org-access.ts';
import { readyAmong } from '../org-servers/org-naming.ts';
import { byNameFileFirst, servingOrg, type OrgServer } from '../org-servers/org-servers.ts';
import { isListedFor, type ServersScope } from '../settings/server-settings.ts';
import { serverFieldsOf, unavailableServer } from './server-fields.ts';
import type { ServerFields, ToolServer } from './tool-server.ts';

interface LookedUp {
  readonly naming: Result.Result<void, ToolNotOffered>;
  readonly listed: Effect.Effect<ToolServer>;
}

export interface OrgListing {
  readonly servers: readonly ToolServer[];
  readonly settings: readonly ServerFields[];
}

export interface ListingWays {
  readonly listServers: (scope: ServersScope, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly listServersInOrg: (scope: ServersScope, named?: string) => Effect.Effect<OrgListing>;
  readonly lookUp: (address: PlaybookAddress, reference: ToolReference) => Effect.Effect<LookedUp>;
  readonly listConnection: (org: string, connection: string) => Effect.Effect<ToolServer | undefined>;
}

async function listedOn(server: OrgServer, loaded: Load): Promise<ToolServer> {
  const linked = await server.linked();
  return 'refused' in linked
    ? unavailableServer(server.settings, linked.refused)
    : (await loaded()).listed(server.settings, linked.link);
}

function listedAmong(servers: readonly OrgServer[], scope: ServersScope, named: string | undefined, loaded: Load) {
  const asked = servers.filter((server) => isListedFor(server.settings, scope, named)).toSorted(byNameFileFirst);
  return Effect.promise(() => Promise.all(asked.map((server) => listedOn(server, loaded))));
}

function settingsAmong(servers: readonly OrgServer[], org: string): readonly ServerFields[] {
  return servingOrg(servers, org).map(({ settings }) => serverFieldsOf(settings));
}

function listingIn(access: OrgAccess, scope: ServersScope, named: string | undefined): Effect.Effect<OrgListing> {
  return Effect.flatMap(access.serversOf(scope.org), (servers) =>
    Effect.map(listedAmong(servers, scope, named, access.loaded), (listed: readonly ToolServer[]) => ({
      servers: listed,
      settings: settingsAmong(servers, scope.org),
    })),
  );
}

export function listingWaysOf(access: OrgAccess): ListingWays {
  return {
    listServers: (scope, named) => Effect.map(listingIn(access, scope, named), ({ servers }) => servers),
    listServersInOrg: (scope, named) => listingIn(access, scope, named),
    lookUp: (address, reference) =>
      Effect.gen(function* () {
        const servers = yield* access.serversOf(address.org);
        const naming = yield* Effect.result(readyAmong(servers, { address, references: [reference] }));
        const listed = Effect.gen(function* () {
          const [server] = yield* listedAmong(servers, address, reference.server, access.loaded);
          return Option.getOrThrow(Option.fromNullishOr(server));
        });
        return { naming, listed };
      }),
    listConnection: (org, connection) =>
      Effect.flatMap(access.serversOf(org), (servers) => {
        const server = servers.find(({ settings }) => settings.connection === connection);
        return server === undefined ? Effect.undefined : Effect.promise(() => listedOn(server, access.loaded));
      }),
  };
}
