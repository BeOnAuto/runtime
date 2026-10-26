import { defineHttpOperation, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import { newestFirst } from '../registry/registry.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionsListed } from './connection-words.ts';
import { foundConnection, loadRegistry } from './registry-access.ts';
import { shownConnection, shownConnections } from './shown-connections.ts';

type Reading = Pick<ConnectionServices, 'secrets'>;

export function defineListConnections({ secrets }: Reading) {
  return defineQuery('org', {
    name: 'list_connections',
    title: 'List connections',
    description: [
      'Lists the connections of the org, newest first.',
      'Each has its server and whether it is pending, connected or broken.',
      'Use it to see which tool servers people added, and whether the person approved one add_connection added.',
    ].join(' '),
    route: { method: 'GET', path: '/connections' },
    inputSchema: Schema.Struct({
      include_removed: Schema.optionalKey(
        Schema.Boolean.annotate({ description: 'Whether to list removed connections as well; false when left out' }),
      ),
    }),
    outputSchema: Schema.Struct({ connections: Schema.Array(ConnectionSchema) }),
    reasons: [],
    handle: Effect.fnUntraced(function* ({ include_removed: includeRemoved = false }) {
      const listed = newestFirst(yield* loadRegistry).filter(
        ({ connection }) => includeRemoved || connection.status !== 'removed',
      );
      return { connections: yield* shownConnections(secrets, listed) };
    }),
    plainLanguage: {
      task: 'list the connections',
      attempt: () => 'list the connections',
      outcome: ({ connections }) => connectionsListed(connections),
    },
  });
}

export function defineGetConnection({ secrets }: Reading) {
  return defineHttpOperation('org', 'query', {
    name: 'get_connection',
    title: 'Get connection',
    description: [
      'Reads one connection of the org: its server, who added it and whether it is pending, connected, broken or removed.',
      'Use it to see whether the person approved a connection; list_connections finds its id.',
      '`id` is the id add_connection answered.',
    ].join(' '),
    route: { method: 'GET', path: '/connections/{id}' },
    body: { kind: 'none' },
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    answer: { kind: 'json', outputSchema: ConnectionSchema },
    reasons: ['not_found'],
    handle: ({ id }) => Effect.flatMap(foundConnection(id), (kept) => shownConnection(secrets, kept)),
  });
}
