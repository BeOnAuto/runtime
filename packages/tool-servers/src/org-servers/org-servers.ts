import { servesOrg } from '@on.auto/config';
import { Effect, Order } from 'effect';

import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ToolServerFailed } from '../access/tool-server-failed.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';
import type { ConnectionUnready } from './connection-source.ts';
import { refusalOf, type Unusable } from './server-refusals.ts';

export type Served = Pick<
  LinkedServerSettings,
  'name' | 'type' | 'orgs' | 'playbooks' | 'allowed' | 'record_content' | 'request_id' | 'connection'
>;

export type Linked = { readonly link: ServerLink } | { readonly refused: Unusable };

export interface OrgServer {
  readonly settings: Served;
  readonly checked: () => Promise<readonly ConnectionUnready[]>;
  readonly linked: () => Promise<Linked>;
}

export function linksOf(
  linked: readonly Linked[],
): Effect.Effect<readonly ServerLink[], ToolNotOffered | ToolServerFailed> {
  const links: ServerLink[] = [];
  for (const each of linked) {
    if ('refused' in each) {
      return Effect.fail(refusalOf(each.refused));
    }
    links.push(each.link);
  }
  return Effect.succeed(links);
}

export function unreadyServer(settings: Served, unready: ConnectionUnready): OrgServer {
  return {
    settings,
    checked: () => Promise.resolve([unready]),
    linked: () => Promise.resolve({ refused: unready }),
  };
}

export function takenByTheConfiguration(name: string): string {
  return `The runtime's configuration sets up a tool server named ${name}, so a connection cannot take that name`;
}

function takenAtUse(name: string): string {
  return `${takenByTheConfiguration(name)}; remove it and add it again under another name`;
}

function unreadyAsTakenByTheFile(name: string): ConnectionUnready {
  return { because: 'connection_not_allowed', detail: takenAtUse(name) };
}

export function withTheFileFirst(files: readonly OrgServer[], connections: readonly OrgServer[]): readonly OrgServer[] {
  const fileNames = new Set(files.map(({ settings }) => settings.name));
  const shadowed = connections.map((server) =>
    fileNames.has(server.settings.name)
      ? unreadyServer(server.settings, unreadyAsTakenByTheFile(server.settings.name))
      : server,
  );
  return [...files, ...shadowed];
}

function isOfTheFile({ settings }: OrgServer): boolean {
  return settings.connection === null;
}

export function namedIn(org: string, servers: readonly OrgServer[]): ReadonlyMap<string, OrgServer> {
  const files = servers.filter((server) => isOfTheFile(server));
  const servingTheOrg = files.filter(({ settings }) => servesOrg(settings, org));
  const connections = servers.filter((server) => !isOfTheFile(server));
  const named = new Map<string, OrgServer>();
  for (const server of [...servingTheOrg, ...connections, ...files]) {
    if (!named.has(server.settings.name)) {
      named.set(server.settings.name, server);
    }
  }
  return named;
}

export const byNameFileFirst: Order.Order<OrgServer> = Order.combine(
  Order.mapInput(Order.String, ({ settings }: OrgServer) => settings.name),
  Order.mapInput(Order.Boolean, (server: OrgServer) => !isOfTheFile(server)),
);
