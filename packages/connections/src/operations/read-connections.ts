import { defineHttpOperation, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import { newestFirst, type KeptConnection } from '../registry/registry.ts';
import { ConnectionIdField, GroupOfMoreSchema } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionsListed } from './connection-words.ts';
import { moreOfferedTo } from './more-asked.ts';
import { foundConnection, loadRegistry } from './registry-access.ts';
import { shownConnections } from './shown-connections.ts';

type Reading = Pick<ConnectionServices, 'secrets' | 'providers' | 'consent' | 'pages'>;

const ListedConnectionSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  more: Schema.Array(GroupOfMoreSchema).annotate({
    description:
      'The groups of scopes its way names that it does not hold and a client here can ask; empty where there is none',
  }),
}).annotate({
  identifier: 'ListedConnection',
  description: 'A connection, and what it may still be granted beside what it holds',
});

const listedOf = Effect.fnUntraced(function* (kept: readonly KeptConnection[], reading: Reading) {
  return yield* moreOfferedTo(yield* shownConnections(reading.secrets, kept), reading);
});

export function defineListConnections(reading: Reading) {
  return defineQuery('org', {
    name: 'list_connections',
    title: 'List connections',
    description: [
      'Lists the connections of the org, newest first.',
      'Each has its server, whether it is pending, connected or broken, and the groups of more it may still be granted.',
      'Use it to see which tool servers people added, and whether the person approved one add_connection added.',
    ].join(' '),
    route: { method: 'GET', path: '/connections' },
    inputSchema: Schema.Struct({
      include_removed: Schema.optionalKey(
        Schema.Boolean.annotate({ description: 'Whether to list removed connections as well; false when left out' }),
      ),
    }),
    outputSchema: Schema.Struct({ connections: Schema.Array(ListedConnectionSchema) }),
    reasons: [],
    handle: Effect.fnUntraced(function* ({ include_removed: includeRemoved = false }) {
      const listed = newestFirst(yield* loadRegistry).filter(
        ({ connection }) => includeRemoved || connection.status !== 'removed',
      );
      return { connections: yield* listedOf(listed, reading) };
    }),
    plainLanguage: {
      task: 'list the connections',
      attempt: () => 'list the connections',
      outcome: ({ connections }) => connectionsListed(connections),
    },
  });
}

export function defineGetConnection(reading: Reading) {
  return defineHttpOperation('org', 'query', {
    name: 'get_connection',
    title: 'Get connection',
    description: [
      'Reads one connection of the org: its server, who added it, whether it is pending, connected, broken or removed, and the groups of more it may still be granted.',
      'Use it to see whether the person approved a connection; list_connections finds its id.',
      '`id` is the id add_connection answered.',
    ].join(' '),
    route: { method: 'GET', path: '/connections/{id}' },
    body: { kind: 'none' },
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    outputSchema: ListedConnectionSchema,
    reasons: ['not_found'],
    handle: Effect.fnUntraced(function* ({ id }) {
      const [listed] = yield* listedOf([yield* foundConnection(id)], reading);
      return yield* Effect.orDie(Effect.fromNullishOr(listed));
    }),
  });
}
