import { Effect, Option } from 'effect';

import type { LinkedAccess } from '../access/linked-access.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { LinkedServerSettings, ToolServers } from '../openapi/described-api.ts';
import { connectionLinks, type LinkConnection } from './connection-links.ts';
import type { ConnectionSource } from './connection-source.ts';
import { withTheFileFirst, type OrgServer } from './org-servers.ts';

export type Load = () => Promise<LinkedAccess>;

export interface OrgAccess {
  readonly loaded: Load;
  readonly serversOf: (org: string) => Effect.Effect<readonly OrgServer[]>;
  readonly close: () => Promise<void>;
}

export interface OrgAccessParts {
  readonly source: ConnectionSource;
  readonly loaded: Load;
  readonly secrets: Pick<Secrets, 'keep' | 'scrub'>;
}

function fileServer(settings: LinkedServerSettings, loaded: Load): OrgServer {
  return {
    settings,
    checked: () => Promise.resolve([]),
    linked: async () => {
      const { fileLinks } = await loaded();
      return { link: Option.getOrThrow(Option.fromNullishOr(fileLinks.get(settings.name))) };
    },
  };
}

export function orgAccessOf(settings: ToolServers, { source, loaded, secrets }: OrgAccessParts): OrgAccess {
  const linkOf: LinkConnection = async (id, server) => (await loaded()).connectionLink(id, server);
  const connections = connectionLinks(source, linkOf, secrets);
  const files = settings.servers.map((server) => fileServer(server, loaded));
  return {
    loaded,
    serversOf: (org) => Effect.map(connections.serversOf(org), (ofTheOrg) => withTheFileFirst(files, ofTheOrg)),
    close: connections.close,
  };
}
