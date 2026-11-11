import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionIdField } from '../operations/connection-fields.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { previousSigningSecretLastsHours } from '../registry/signing-decisions.ts';
import { ConnectionSigningSchema, signingChanged } from './signing-changes.ts';

export function defineRemoveConnectionSigningSecret({ secrets }: Pick<ConnectionServices, 'secrets'>) {
  return defineHttpOperation('org', 'command', {
    name: 'remove_connection_signing_secret',
    title: 'Remove connection signing secret',
    description: [
      "Removes a connection's signing secret and the one it replaced, so its service may answer nothing more by signing what it sends.",
      `With previous, it removes only the one replaced, which otherwise verifies for ${previousSigningSecretLastsHours} hours after the change, once the service signs with the new one.`,
      'The runtime forgets each secret removed, and removing what the connection does not hold changes nothing.',
    ].join(' '),
    route: { method: 'DELETE', path: '/connections/{id}/signing-secret' },
    body: { kind: 'none' },
    repeatable: true,
    inputSchema: Schema.Struct({
      id: ConnectionIdField,
      previous: Schema.optionalKey(
        Schema.Boolean.annotate({
          description: 'Whether to remove only the signing secret a new one replaced; false when left out',
        }),
      ),
    }),
    outputSchema: ConnectionSigningSchema,
    reasons: ['not_found'],
    handle: ({ id, previous = false }) =>
      signingChanged(secrets, {
        type: 'remove_signing_secret',
        connection: id,
        which: previous ? 'previous' : 'all',
      }).pipe(Effect.catchTag('conflict', Effect.die)),
  });
}
