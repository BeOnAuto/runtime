import { defineHttpOperation } from '@on.auto/operations';
import { AccountTypeSchema } from '@on.auto/providers';
import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { recordInRegistry } from './registry-access.ts';
import { shownConnection } from './shown-connections.ts';

export function defineSetConnectionAccountType(services: Pick<ConnectionServices, 'secrets' | 'providers'>) {
  const { secrets } = services;
  return defineHttpOperation('org', 'command', {
    name: 'set_connection_account_type',
    title: 'Set connection account type',
    description: [
      'Sets the kind of account a connection acts as at its service.',
      'service means an account the company made for automations. personal means the account of the person who connected it.',
      'Only this mark changes. The connection keeps its credential and everything else.',
      'Setting the type the connection already has records nothing.',
      'A removed connection is refused as conflict, and so is a connection that acts as the app or sends no credential.',
      "A type the connection's way does not take is refused as invalid_input.",
    ].join(' '),
    route: { method: 'PUT', path: '/connections/{id}/account-type' },
    body: { kind: 'json' },
    repeatable: true,
    inputSchema: Schema.Struct({
      id: ConnectionIdField,
      account_type: AccountTypeSchema.annotate({
        description:
          'service when the connection acts as an account the company made for automations. personal when it acts as the account of the person who connected it.',
      }),
    }),
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'conflict', 'invalid_input'],
    handle: Effect.fnUntraced(function* ({ id, account_type: accountType }) {
      const kept = yield* recordInRegistry(services, {
        type: 'set_account_type',
        connection: id,
        account_type: accountType,
      }).pipe(Effect.catchTag('forbidden', Effect.die));
      return yield* shownConnection(secrets, kept);
    }),
  });
}
