import { defineHttpOperation } from '@on.auto/operations';
import type { ConsentClient } from '@on.auto/tool-servers';
import { Effect, Schema } from 'effect';

import { studioBaseFor, type ConnectPages } from '../links/connect-page.ts';
import { tokenSha256Of } from '../links/link-token.ts';
import { ClientSourceField, ConnectionIdField, ExpiresAtField, TokenField } from '../operations/connection-fields.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { ConnectionSchema, connectionShown, type RecordedConnection } from '../registry/connection.ts';
import { isOpenConsent, linkedConnectionOf } from '../registry/registry-lookup.ts';
import { wayOf } from './consent-asking.ts';

export const LinkSchema = Schema.Struct({ id: ConnectionIdField, token: TokenField });

const answeringTheRecord = { kind: 'json', outputSchema: ConnectionSchema } as const;

const LinkedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  link: Schema.Struct({ expires_at: ExpiresAtField }),
  consent: Schema.optionalKey(
    Schema.Struct({
      started_at: Schema.String.annotate({ description: 'When the consent was started, in ISO 8601 UTC' }),
      expires_at: Schema.String.annotate({ description: 'When the consent must be finished by, in ISO 8601 UTC' }),
    }).annotate({ description: 'The consent started and not finished, while it is open' }),
  ),
  client_source: Schema.optionalKey(
    ClientSourceField.annotate({
      description:
        "For a connection connected by consent, the source of the client a start would take now, by the rule the start takes it by: auto where it would begin through Auto's consent service. Left out where the runtime has no client the way takes",
    }),
  ),
}).annotate({
  identifier: 'LinkedConnection',
  description: 'The connection an open link names, and when the link expires',
});

interface LinkReading {
  readonly consent: Pick<ConsentClient, 'hadSources'>;
  readonly pages: ConnectPages;
}

function sourceOfAStart(connection: RecordedConnection, { consent, pages }: LinkReading) {
  if (connection.credential.kind !== 'authorization') {
    return Effect.succeed({});
  }
  return Effect.map(consent.hadSources(studioBaseFor(pages)), ({ sourceOf }) => {
    const source = sourceOf(wayOf(connection));
    return source === undefined ? {} : { client_source: source };
  });
}

export function defineReadLink(reading: LinkReading) {
  return defineHttpOperation('org', 'query', {
    name: 'read_link',
    title: 'Read link',
    description: [
      "Reads the connection an open link names, and when the link expires, so Studio's page can show what the person is asked to approve and for how long.",
      'A link is open for ten minutes from when add_connection gave it, until the connection is approved.',
      'A token that is unknown, used up or expired is answered as not found.',
    ].join(' '),
    route: { method: 'GET', path: '/connections/{id}/link/{token}' },
    body: { kind: 'none' },
    inputSchema: LinkSchema,
    answer: { kind: 'json', outputSchema: LinkedSchema },
    reasons: ['not_found'],
    handle: Effect.fnUntraced(function* ({ id, token }) {
      const registry = yield* loadRegistry;
      const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson: false };
      const acted = yield* actedNow;
      const kept = yield* Effect.fromResult(linkedConnectionOf(registry, use, acted)).pipe(
        Effect.catchTag('forbidden', Effect.die),
      );
      const started = isOpenConsent(kept, acted.at)
        ? { consent: { started_at: kept.consent.started_at, expires_at: kept.consent.expires_at } }
        : {};
      const source = yield* sourceOfAStart(kept.connection, reading);
      return {
        ...connectionShown(kept.connection, null),
        link: { expires_at: kept.link.expires_at },
        ...started,
        ...source,
      };
    }),
  });
}

export function defineApprove({ bindsPerson }: { readonly bindsPerson: boolean }) {
  return defineHttpOperation('org', 'command', {
    name: 'approve',
    title: 'Approve connection',
    description: [
      'Approves a connection that takes no credential to give, one of the credential none or reference, through its open link, and answers it connected.',
      'On a runtime that signs people in, only the person who added the connection may approve it.',
      'A connection that takes a secret or client credentials is approved by give_credential instead.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/approve' },
    body: { kind: 'json' },
    inputSchema: LinkSchema,
    answer: answeringTheRecord,
    reasons: ['not_found', 'forbidden', 'conflict'],
    handle: ({ id, token }) =>
      Effect.map(
        recordInRegistry({ type: 'approve', connection: id, token_sha256: tokenSha256Of(token), bindsPerson }).pipe(
          Effect.catchTag('invalid_input', Effect.die),
        ),
        ({ connection }) => connectionShown(connection, null),
      ),
  });
}
