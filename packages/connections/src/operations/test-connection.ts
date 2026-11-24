import { Conflict, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { exchangeCheckedFor } from '../page/checked-exchanges.ts';
import type { ExchangeChecking } from '../page/exchange-checks.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { exchangesItsToken } from '../serving/exchanged-credentials.ts';
import { ConnectionIdField } from './connection-fields.ts';
import { foundConnection } from './registry-access.ts';

const TestedSchema = Schema.Struct({
  reached: Schema.Array(Schema.String).annotate({
    description:
      'The names of what the connection reaches at the service, as the check its way declares lists them, at most 50. It is empty where the connection reaches nothing, or where its way declares no check.',
  }),
}).annotate({ identifier: 'TestedConnection', description: 'What a connected connection reaches now' });

function untestedOf({ connection }: KeptConnection): Conflict | undefined {
  const { name, status } = connection;
  if (!exchangesItsToken({ connection })) {
    return new Conflict({
      detail: `The connection ${name} does not exchange a token Auto signs, so it is not tested this way.`,
    });
  }
  return status === 'connected'
    ? undefined
    : new Conflict({ detail: `The connection ${name} is ${status}, so it is not tested until it is connected.` });
}

export function defineTestConnection(services: ExchangeChecking) {
  return defineHttpOperation('org', 'query', {
    name: 'test_connection',
    title: 'Test connection',
    description: [
      'Tests a connected connection that exchanges a token Auto signs: Auto gets a token from the service and, where the way declares a check, lists what the connection reaches, and answers the names in reached.',
      'It saves nothing.',
      'Where the service refuses the token it is refused as invalid_input, and where the service does not answer, as unavailable.',
      'A connection of another kind, or one that is not connected, is refused as conflict.',
      'On a runtime that signs people in, only an admin of the organization may test it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/test' },
    body: { kind: 'json' },
    permittedBy: ['org:write'],
    connectionsManagement: true,
    inputSchema: Schema.Struct({ id: ConnectionIdField }),
    outputSchema: TestedSchema,
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id }) {
      const kept = yield* foundConnection(services, id);
      const refusal = untestedOf(kept);
      if (refusal !== undefined) {
        return yield* Effect.fail(refusal);
      }
      const { reached } = yield* exchangeCheckedFor(kept, services);
      return { reached: reached ?? [] };
    }),
  });
}
