import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import { linkedThrough, recordInRegistry } from '../operations/registry-access.ts';
import { ServiceAccountSchema } from '../registry/connection.ts';
import { managedServiceAccountRefusalOf } from '../registry/service-account-decisions.ts';
import { serviceAccountMadeFor, type ServiceAccounting } from './service-account-ports.ts';

const LinkSchema = Schema.Struct({ id: ConnectionIdField, token: TokenField });

export function defineCreateServiceAccount(services: ServiceAccounting) {
  return defineHttpOperation('org', 'command', {
    name: 'create_service_account',
    title: 'Create service account',
    description: [
      'Creates the service account that a connection acts as, where the way the connection connects with through its open link is the way of a service account Auto creates, and answers its email.',
      'The person then gives that email access at the service before approving the connection.',
      'Asked again, it answers the same account and creates no other.',
      'Where Auto cannot create the account now, it answers unavailable and nothing is saved.',
      'A connection whose way acts as no account Auto creates is refused as conflict, and so is a connection that is connected or broken, unless another way was chosen for it through its link.',
      'On a runtime that signs people in, only an admin of the organization may create it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/service-account' },
    body: { kind: 'json' },
    repeatable: true,
    connectionsManagement: true,
    inputSchema: LinkSchema,
    outputSchema: ServiceAccountSchema,
    reasons: ['not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* (link) {
      const { kept, use } = yield* linkedThrough(services, link);
      const refusal = managedServiceAccountRefusalOf(kept);
      if (refusal !== undefined) {
        return yield* Effect.fail(refusal);
      }
      if (kept.serviceAccount !== undefined) {
        return { email: kept.serviceAccount.email };
      }
      const made = yield* serviceAccountMadeFor(kept, services);
      yield* recordInRegistry(services, { type: 'record_service_account', ...use, ...made }).pipe(
        Effect.catchTag('invalid_input', Effect.die),
      );
      return { email: made.email };
    }),
  });
}
