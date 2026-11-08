import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option, Result } from 'effect';

import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Load, OrgAccess } from '../org-servers/org-access.ts';
import { readyAmong } from '../org-servers/org-naming.ts';
import { byNameFileFirst, servingOrg, type OrgServer } from '../org-servers/org-servers.ts';
import { isListedFor, type ServersScope } from '../settings/server-settings.ts';
import { availableServer, serverFieldsOf, unavailableServer } from './server-fields.ts';
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

type ListOn = (server: OrgServer) => Promise<ToolServer>;

async function toolsListedOn(server: OrgServer, loaded: Load) {
  const linked = await server.linked();
  return 'refused' in linked ? Result.fail(linked.refused) : (await loaded()).listed(server.settings, linked.link);
}

async function listedOn(server: OrgServer, loaded: Load): Promise<ToolServer> {
  const listed = await toolsListedOn(server, loaded);
  return Result.isFailure(listed)
    ? unavailableServer(server.settings, listed.failure)
    : availableServer(server.settings, listed.success);
}

async function keptOrListedOn(server: OrgServer, org: string, access: OrgAccess): Promise<ToolServer> {
  const { keptAs, settings } = server;
  if (keptAs === undefined) {
    return listedOn(server, access.loaded);
  }
  const kept = access.listingsKept.toolsOf(org, keptAs);
  if (kept !== undefined) {
    return availableServer(settings, kept);
  }
  const listed = await toolsListedOn(server, access.loaded);
  if (Result.isFailure(listed)) {
    return unavailableServer(settings, listed.failure);
  }
  access.listingsKept.keep(org, keptAs, listed.success);
  return availableServer(settings, listed.success);
}

function listedAmong(servers: readonly OrgServer[], scope: ServersScope, named: string | undefined, listOn: ListOn) {
  const asked = servers.filter((server) => isListedFor(server.settings, scope, named)).toSorted(byNameFileFirst);
  return Effect.promise(() => Promise.all(asked.map((server) => listOn(server))));
}

function settingsAmong(servers: readonly OrgServer[], org: string): readonly ServerFields[] {
  return servingOrg(servers, org).map(({ settings }) => serverFieldsOf(settings));
}

function keptAsAmong(servers: readonly OrgServer[]): ReadonlySet<string> {
  return new Set(servers.flatMap(({ keptAs }) => (keptAs === undefined ? [] : [keptAs])));
}

function keptOrListedIn(access: OrgAccess, scope: ServersScope, named: string | undefined): Effect.Effect<OrgListing> {
  return Effect.flatMap(access.serversOf(scope.org), (servers) => {
    access.listingsKept.keepOnly(scope.org, keptAsAmong(servers));
    const listOn: ListOn = (server) => keptOrListedOn(server, scope.org, access);
    return Effect.map(listedAmong(servers, scope, named, listOn), (listed: readonly ToolServer[]) => ({
      servers: listed,
      settings: settingsAmong(servers, scope.org),
    }));
  });
}

export function listingWaysOf(access: OrgAccess): ListingWays {
  const listOn: ListOn = (server) => listedOn(server, access.loaded);
  return {
    listServers: (scope, named) =>
      Effect.flatMap(access.serversOf(scope.org), (servers) => listedAmong(servers, scope, named, listOn)),
    listServersInOrg: (scope, named) => keptOrListedIn(access, scope, named),
    lookUp: (address, reference) =>
      Effect.gen(function* () {
        const servers = yield* access.serversOf(address.org);
        const naming = yield* Effect.result(readyAmong(servers, { address, references: [reference] }));
        const listed = Effect.gen(function* () {
          const [server] = yield* listedAmong(servers, address, reference.server, listOn);
          return Option.getOrThrow(Option.fromNullishOr(server));
        });
        return { naming, listed };
      }),
    listConnection: (org, connection) =>
      Effect.flatMap(access.serversOf(org), (servers) => {
        const server = servers.find(({ settings }) => settings.connection === connection);
        return server === undefined ? Effect.undefined : Effect.promise(() => listOn(server));
      }),
  };
}
