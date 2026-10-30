import { Caller, OrgContext, defineCommand, quoted } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { connectOf } from '../links/connect-page.ts';
import { adderRefusalOf, bindsPerson } from '../policy/policy-rules.ts';
import { AddedSchema, ConnectionIdField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { linkOffering, reconnectedWordsOf } from './connection-words.ts';
import { linkIssuedFor } from './more-asked.ts';
import { recordInRegistry, recordedCaller } from './registry-access.ts';
import { shownConnection } from './shown-connections.ts';

const description = [
  "Issues a new link to Studio's page for a connection that is broken, or whose link ran out, so the person gives its credential or signs in again; the link before stops working, and nothing else changes.",
  'Use it where list_connections or search says a connection is broken and its reason says to reconnect it, rather than removing it and adding it again.',
  'With more, a group list_connections offers, the link asks its scopes beside those the connection holds.',
  'It answers the connection with the link, which the person who added it opens within 24 hours, or, where a broken connection sends a variable of the runtime that is set, connected again at once.',
].join(' ');

type Reconnecting = Pick<ConnectionServices, 'secrets' | 'pages' | 'providers' | 'access' | 'variables' | 'consent'>;

export function defineReconnectConnection(services: Reconnecting) {
  const { secrets, pages, providers, access, variables } = services;
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
    reasons: ['forbidden', 'not_found', 'conflict', 'invalid_input'],
    handle: Effect.fnUntraced(function* ({ id, more }) {
      const adderRefusal = adderRefusalOf(access, yield* Caller);
      if (adderRefusal !== undefined) {
        return yield* Effect.fail(adderRefusal);
      }
      const { org } = yield* OrgContext;
      const { token, ...link } = yield* linkIssuedFor(id, more, services);
      const kept = yield* recordInRegistry({
        type: 'reconnect',
        connection: id,
        bindsPerson: bindsPerson(access),
        link,
        connected_by: yield* recordedCaller,
        variablesSet: new Set(variables.keys()),
      }).pipe(Effect.catchTag('invalid_input', Effect.die));
      const shown = yield* shownConnection(secrets, kept);
      return kept.link?.token_sha256 === link.token_sha256
        ? { ...shown, connect: connectOf(pages, { org, connection: id, token }, link.expires_at) }
        : shown;
    }),
    plainLanguage: {
      task: 'reconnect a connection',
      attempt: ({ id }) => `reconnect the connection ${quoted(id)}`,
      outcome: (reconnected, { more }) => reconnectedWordsOf(reconnected, providers, more),
    },
    ...linkOffering(secrets),
  });
}
