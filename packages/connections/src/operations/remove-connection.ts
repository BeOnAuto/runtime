import { defineCommand, quoted } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed } from './connection-words.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineRemoveConnection({ secrets }: Pick<ConnectionServices, 'secrets'>) {
  return defineCommand('org', {
    name: 'remove_connection',
    title: 'Remove connection',
    description: [
      'Removes a connection of the org for good: no playbook may use it any more, and its credential is forgotten.',
      'Use it only when the person asks to remove that connection.',
      '`id` is its id, and removing a removed connection changes nothing.',
    ].join(' '),
    irreversible: true,
    repeatable: true,
    route: { method: 'DELETE', path: '/connections/{id}' },
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'conflict'],
    handle: Effect.fnUntraced(function* ({ id }) {
      const kept = yield* recordInRegistry({ type: 'remove', connection: id }).pipe(
        Effect.catchTags({ forbidden: Effect.die, invalid_input: Effect.die }),
      );
      if (kept.secretId !== undefined) {
        yield* secrets.forget(kept.secretId);
      }
      if (kept.consent !== undefined) {
        yield* secrets.forget(kept.consent.verifier_secret_id);
      }
      return connectionShown(kept.connection, null);
    }),
    plainLanguage: {
      task: 'remove a connection',
      attempt: ({ id }) => `remove the connection ${quoted(id)}`,
      outcome: (connection) =>
        `Removed ${connectionNamed(connection)}. No playbook may use it, and its credential is forgotten.`,
    },
  });
}
