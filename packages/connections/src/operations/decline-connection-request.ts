import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { declineRefusalOf } from '../registry/request-decisions.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { foundConnection, recordInRegistry } from './registry-access.ts';
import { removedAround } from './remove-connection.ts';

type DecliningServices = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages' | 'providers' | 'resolve'>;

const declinedConnection = Effect.fnUntraced(function* (id: string, services: DecliningServices) {
  const found = yield* foundConnection(services, id);
  const refusal = declineRefusalOf(found);
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  const recording = recordInRegistry(services, { type: 'decline', connection: id }).pipe(
    Effect.catchTags({ forbidden: Effect.die, invalid_input: Effect.die }),
    Effect.map((removed) => ({ removed })),
  );
  const { removed } = yield* removedAround(found, recording, services);
  return connectionShown(removed.connection, null);
});

export function defineDeclineConnectionRequest(services: DecliningServices) {
  return defineHttpOperation('org', 'command', {
    name: 'decline_connection_request',
    title: 'Decline connection request',
    description: [
      'Declines the open request for a connection that someone who may not approve connections here sent to the admins.',
      'The connection is removed, so no playbook may use it, and anything given for it on its page is forgotten.',
      'A connection with no open request is refused as conflict.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/decline' },
    body: { kind: 'none' },
    irreversible: true,
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id }) {
      return yield* declinedConnection(id, services);
    }),
  });
}
