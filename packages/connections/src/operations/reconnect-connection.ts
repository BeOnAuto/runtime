import { Caller, defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { adderRefusalOf, bindsPerson } from '../policy/policy-rules.ts';
import { addedAgainOf } from '../replacements/connected-again.ts';
import { addedAgainFrom } from '../replacements/replaced-reconnections.ts';
import { AddedSchema, ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { addedAgainWordsOf, linkOffering, reconnectedWordsOf, reconnectionAttempted } from './connection-words.ts';
import { linkedAgain } from './linked-again.ts';
import { foundConnection } from './registry-access.ts';

const description = [
  "Issues a new link to Studio's page for a connection that is broken, or whose link the person no longer has, so the person gives its credential or signs in again; the link before stops working.",
  'Use it where list_connections or search says a connection is broken and its reason says to reconnect it, or where the person no longer has the link of a connection that is not connected yet.',
  'With more, a group list_connections offers, the link asks its scopes beside those the connection holds.',
  'It answers the connection with the link, which the person who added it opens, or, where a broken connection sends a variable of the runtime that is set, connected again at once.',
].join(' ');

export function defineReconnectConnection(services: ConnectionServices) {
  const { providers, access } = services;
  return defineCommand('org', {
    name: 'reconnect_connection',
    title: 'Reconnect connection',
    description,
    route: { method: 'POST', path: '/connections/{id}/link' },
    inputSchema: Schema.Struct({
      id: ConnectionIdField,
      more: Schema.optionalKey(
        Schema.String.annotate({
          description: 'A group list_connections offers the connection, by name; a plain link when left out',
        }),
      ),
    }),
    outputSchema: AddedSchema,
    reasons: ['forbidden', 'not_found', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, more }) {
      const adderRefusal = adderRefusalOf(access, yield* Caller);
      if (adderRefusal !== undefined) {
        return yield* Effect.fail(adderRefusal);
      }
      const found = yield* foundConnection(services, id);
      const again = yield* addedAgainOf(found, services);
      return yield* again === undefined
        ? linkedAgain(id, more, services)
        : addedAgainFrom({ ...again, found, more, bindsPerson: bindsPerson(access) }, services);
    }),
    plainLanguage: {
      task: 'reconnect a connection',
      attempt: reconnectionAttempted,
      outcome: (reconnected, { id, more }) =>
        reconnected.id === id
          ? reconnectedWordsOf(reconnected, providers, more)
          : addedAgainWordsOf(reconnected, providers, more),
    },
    ...linkOffering(services),
  });
}
