import { defineHttpOperation, type Conflict } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import {
  ClientSourceField,
  ConnectionIdField,
  ExpiresAtField,
  GroupOfMoreSchema,
  TokenField,
} from '../operations/connection-fields.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { actedNow, loadRegistry, recordInRegistry, recordedCaller } from '../operations/registry-access.ts';
import { keptAskedOf, moreAskedOf, noLongerNamed, type AskedMore } from '../providers/asking-more.ts';
import { ConnectionSchema, connectionShown, scopesAddedTo } from '../registry/connection.ts';
import { isOpenConsent, linkedConnectionOf, type KeptWithLink } from '../registry/registry-lookup.ts';
import { isCoveredHere, sourceOfAStartOf, sourcesFor, type Sources } from './consent-asking.ts';

export const LinkSchema = Schema.Struct({ id: ConnectionIdField, token: TokenField });

const answeringTheRecord = { kind: 'json', outputSchema: ConnectionSchema } as const;

const LinkedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  asked_scopes: ConnectionSchema.fields.asked_scopes.annotate({
    description:
      'The scopes the connection asked, and beside them those the consent this link starts asks, each with what a connection can do through it; empty where it asks none',
  }),
  link: Schema.Struct({
    expires_at: ExpiresAtField,
    more: Schema.optionalKey(
      GroupOfMoreSchema.annotate({
        description: 'The group of more the link asks beside what the connection holds, where it was given for one',
      }),
    ),
  }),
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

type LinkReading = Pick<ConnectionServices, 'consent' | 'pages' | 'providers'>;

type Linked = KeptWithLink['connection'];

interface AskedOfTheLink {
  readonly scope: string | undefined;
  readonly says: Readonly<Record<string, string>>;
  readonly group?: AskedMore['group'];
}

function askedOfALinkForMore(
  connection: Linked,
  providers: LinkReading['providers'],
  more: string,
): Result.Result<AskedOfTheLink, Conflict> {
  const asked = moreAskedOf(connection, providers, more);
  return asked === undefined ? Result.fail(noLongerNamed(connection, more)) : Result.succeed(asked);
}

function keptUnlessUncovered(connection: Linked, sources: Sources): string | undefined {
  const kept = keptAskedOf(connection);
  return kept === connection.credential.scope || isCoveredHere(connection, kept, sources)
    ? kept
    : connection.credential.scope;
}

export function askedOfTheLink(
  { connection, link }: KeptWithLink,
  providers: LinkReading['providers'],
  sources: Sources,
): Result.Result<AskedOfTheLink, Conflict> {
  return link.more === undefined
    ? Result.succeed({ scope: keptUnlessUncovered(connection, sources), says: {} })
    : askedOfALinkForMore(connection, providers, link.more);
}

function moreOfTheLink({ group }: AskedOfTheLink) {
  return group === undefined ? {} : { more: { name: group.name, for: group.for } };
}

export function defineReadLink(reading: LinkReading) {
  return defineHttpOperation('org', 'query', {
    name: 'read_link',
    title: 'Read link',
    description: [
      "Reads the connection an open link names, and when the link expires, so Studio's page can show what the person is asked to approve and for how long.",
      'A link is open for 24 hours from when add_connection or reconnect_connection gave it, until the connection is approved or a newer link replaces it.',
      "A link reconnect_connection gave for a group of more names the group, and the connection's asked_scopes hold the scopes its consent asks beside those asked before.",
      'A token that is unknown, used up, expired or replaced is answered as not found.',
    ].join(' '),
    route: { method: 'GET', path: '/connections/{id}/link/{token}' },
    body: { kind: 'none' },
    permittedBy: ['org:write'],
    inputSchema: LinkSchema,
    answer: { kind: 'json', outputSchema: LinkedSchema },
    reasons: ['not_found', 'conflict'],
    handle: Effect.fnUntraced(function* ({ id, token }) {
      const registry = yield* loadRegistry;
      const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson: false };
      const acted = yield* actedNow;
      const kept = yield* Effect.fromResult(linkedConnectionOf(registry, use, acted)).pipe(
        Effect.catchTag('forbidden', Effect.die),
      );
      const sources = yield* sourcesFor(kept.connection, reading);
      const asked = yield* Effect.fromResult(askedOfTheLink(kept, reading.providers, sources));
      const started = isOpenConsent(kept, acted.at)
        ? { consent: { started_at: kept.consent.started_at, expires_at: kept.consent.expires_at } }
        : {};
      const source = sourceOfAStartOf(kept.connection, asked.scope, sources);
      const shown = connectionShown(kept.connection, null);
      return {
        ...shown,
        asked_scopes: scopesAddedTo(shown.asked_scopes, asked.scope, asked.says),
        link: { expires_at: kept.link.expires_at, ...moreOfTheLink(asked) },
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
    handle: Effect.fnUntraced(function* ({ id, token }) {
      const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson };
      const { connection } = yield* recordInRegistry({
        type: 'approve',
        ...use,
        connected_by: yield* recordedCaller,
      }).pipe(Effect.catchTag('invalid_input', Effect.die));
      return connectionShown(connection, null);
    }),
  });
}
