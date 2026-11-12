import { defineCommand, OrgContext } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { keyEndedBeforeRemoval, newerKeyEndedOf } from '../page/connection-gateways.ts';
import { forgottenClientsOf, forgottenCredentialOf } from '../page/forgotten-credentials.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { signingSecretsHeldBy } from '../registry/kept-signing.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed, removalAttempted } from './connection-words.ts';
import { foundConnection, recordInRegistry } from './registry-access.ts';

type RemovalServices = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages' | 'providers' | 'resolve'>;

const removedConnection = Effect.fnUntraced(function* (id: string, services: RemovalServices) {
  const { secrets } = services;
  const found = yield* foundConnection(id);
  yield* keyEndedBeforeRemoval(found, services);
  const kept = yield* recordInRegistry({ type: 'remove', connection: id }).pipe(
    Effect.catchTags({ forbidden: Effect.die, invalid_input: Effect.die }),
  );
  yield* newerKeyEndedOf(found, kept, services);
  yield* forgottenCredentialOf(kept, services);
  yield* forgottenClientsOf(kept, services);
  yield* Effect.forEach(signingSecretsHeldBy(kept.signing), (secretId) => secrets.forget(secretId), {
    discard: true,
  });
  if (kept.consent !== undefined) {
    yield* secrets.forget(kept.consent.verifier_secret_id);
  }
  return connectionShown(kept.connection, null);
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
