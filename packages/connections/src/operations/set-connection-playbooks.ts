import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import { ConnectionIdField, PlaybooksField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { mayChoosePlaybooks, recordInRegistry } from './registry-access.ts';
import { shownConnection } from './shown-connections.ts';

export function defineSetConnectionPlaybooks(services: Pick<ConnectionServices, 'secrets' | 'providers'>) {
  const { secrets } = services;
  return defineHttpOperation('org', 'command', {
    name: 'set_connection_playbooks',
    title: 'Set connection playbooks',
    description: [
      'Sets which playbooks of the org may use a connection: playbooks lists them by id, and null gives the connection to every playbook of the org, those made later among them.',
      'A run under way keeps the tools it opened until it ends. A run that opens its tools afterwards in a playbook no longer listed is refused the connection, and so is a call of a tool by hand there.',
      'Setting the playbooks the connection serves already records nothing, and a removed connection is refused as conflict.',
      'A caller that may access only some playbooks of the org is refused as forbidden.',
    ].join(' '),
    route: { method: 'PUT', path: '/connections/{id}/playbooks' },
    body: { kind: 'json' },
    repeatable: true,
    connectionsManagement: true,
    inputSchema: Schema.Struct({ id: ConnectionIdField, playbooks: PlaybooksField }),
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'forbidden', 'conflict'],
    handle: Effect.fnUntraced(function* ({ id, playbooks }) {
      yield* mayChoosePlaybooks;
      const kept = yield* recordInRegistry(services, { type: 'set_playbooks', connection: id, playbooks }).pipe(
        Effect.catchTag('invalid_input', Effect.die),
      );
      return yield* shownConnection(secrets, kept);
    }),
  });
}
