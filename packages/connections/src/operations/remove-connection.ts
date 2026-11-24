import { defineCommand, OrgContext } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { forgottenOnRemoval } from '../page/forgotten-credentials.ts';
import { endedBeforeRemoval } from '../page/service-account-ports.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed, removalAttempted } from './connection-words.ts';
import { foundConnection, recordInRegistry } from './registry-access.ts';

type RemovalServices = Pick<
  ConnectionServices,
  'secrets' | 'consent' | 'policy' | 'pages' | 'providers' | 'resolve' | 'connectionRemoved' | 'managedServiceAccounts'
>;

function removedWhereItIsKept({ connection }: KeptConnection, { connectionRemoved }: RemovalServices) {
  return connectionRemoved === undefined
    ? Effect.void
    : connectionRemoved({ connection: connection.id, account: connection.account?.id });
}

export const removedAround = Effect.fnUntraced(function* <Recorded extends { readonly removed: KeptConnection }, E, R>(
  found: KeptConnection,
  recording: Effect.Effect<Recorded, E, R>,
  services: RemovalServices,
) {
  yield* endedBeforeRemoval(found, services);
  const recorded = yield* recording;
  yield* forgottenOnRemoval(found, recorded.removed, services);
  yield* removedWhereItIsKept(recorded.removed, services);
  return recorded;
});

const removedConnection = Effect.fnUntraced(function* (id: string, services: RemovalServices) {
  const found = yield* foundConnection(services, id);
  const recording = recordInRegistry(services, { type: 'remove', connection: id }).pipe(
    Effect.catchTag('invalid_input', Effect.die),
    Effect.map((removed) => ({ removed })),
  );
  const { removed } = yield* removedAround(found, recording, services);
  return connectionShown(removed.connection, null);
});

export function defineRemoveConnection(services: RemovalServices) {
  return defineCommand('org', {
    name: 'remove_connection',
    title: 'Remove connection',
    description: [
      'Removes a connection of the org for good: no playbook may use it any more, and its credential is forgotten.',
      'Use it when the person asks to remove that connection.',
      'Removing a removed connection changes nothing.',
    ].join(' '),
    irreversible: true,
    repeatable: true,
    connectionsManagement: true,
    route: { method: 'DELETE', path: '/connections/{id}' },
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id }) {
      const { org } = yield* OrgContext;
      return yield* removedConnection(id, services).pipe(Effect.annotateLogs({ org, connection: id }));
    }),
    plainLanguage: {
      task: 'remove a connection',
      attempt: ({ id }) => removalAttempted(id),
      outcome: (connection) =>
        `Removed ${connectionNamed(connection)}. No playbook may use it, and its credential is forgotten.`,
    },
  });
}
