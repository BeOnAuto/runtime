import { Caller, defineHttpOperation, defineQuery, mayCall, type Runnable } from '@on.auto/operations';
import { orgReadsTogether } from '@on.auto/operations/entities';
import { Effect, Schema } from 'effect';

import { newestFirst } from '../registry/registry.ts';
import { ConnectionIdField } from './connection-fields.ts';
import { connectionsListed } from './connection-words.ts';
import { ListedConnectionSchema, listedOf, type Reading } from './listed-connections.ts';
import { foundConnection, loadRegistry } from './registry-access.ts';

export function defineListConnections(reading: Reading, managing: Runnable<'org'>) {
  return defineQuery('org', {
    name: 'list_connections',
    staleOn: [{ kind: 'connection' }],
    title: 'List connections',
    description: [
      'Lists the connections of the org, newest first.',
      'Each has its server, whether it is pending, connected or broken, and the groups of more it may still be granted.',
      'Use it to see which tool servers people added, and whether the person approved one add_connection added.',
      'Each also lists, under `event_types`, the events it reports once it is connected.',
      "To start a workflow when one happens, write a trigger whose filter has the connection's `source` and the event's `type`.",
    ].join(' '),
    route: { method: 'GET', path: '/connections' },
    inputSchema: Schema.Struct({
      include_removed: Schema.optionalKey(
        Schema.Boolean.annotate({ description: 'Whether to list removed connections as well; false when left out' }),
      ),
    }),
    outputSchema: Schema.Struct({
      connections: Schema.Array(ListedConnectionSchema),
      may_manage: Schema.Boolean.annotate({
        description: 'true when this caller may remove the connections of the org. false when it may not.',
      }),
    }),
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* ({ include_removed: includeRemoved = false }) {
      const listed = newestFirst(yield* orgReadsTogether(loadRegistry(reading))).filter(
        ({ connection }) => includeRemoved || connection.status !== 'removed',
      );
      const caller = yield* Caller;
      return {
        connections: yield* listedOf(listed, reading),
        may_manage: yield* mayCall({ operation: managing, caller, org: caller.org }),
      };
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
    staleOn: [{ kind: 'connection', keyedBy: { connection: 'id' } }],
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
    reasons: ['not_found', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id }) {
      const [listed] = yield* listedOf([yield* foundConnection(reading, id)], reading);
      return yield* Effect.orDie(Effect.fromNullishOr(listed));
    }),
  });
}
