import { defineCommand, quoted } from '@on.auto/operations';
import { Effect, Function, Option, Schema } from 'effect';

import { consentAskedOf, namedOf } from '../page/consent-asking.ts';
import { unrevokedWordsOf } from '../page/consent-words.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed } from './connection-words.ts';
import { recordInRegistry } from './registry-access.ts';

type RemovalServices = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages'>;

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function revokedTokensOf({ connection, secretId }: KeptConnection, services: RemovalServices): Effect.Effect<void> {
  const { credential } = connection;
  if (credential.kind !== 'authorization' || secretId === undefined) {
    return Effect.void;
  }
  const client = { client_id: required(credential.client_id), client_source: required(credential.client_source) };
  return services.secrets.read(secretId).pipe(
    Effect.orElseSucceed(Function.constUndefined),
    Effect.flatMap((row) =>
      row === undefined
        ? Effect.void
        : services.consent.revoke({ ...consentAskedOf(connection, services), client, tokens: row.value }),
    ),
    Effect.catch((failure) => Effect.logWarning(unrevokedWordsOf(namedOf(connection), failure))),
  );
}

export function defineRemoveConnection(services: RemovalServices) {
  const { secrets } = services;
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
      yield* revokedTokensOf(kept, services);
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
