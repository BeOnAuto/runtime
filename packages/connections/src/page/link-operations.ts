import { CallingClientSchema, defineHttpOperation, OrgContext, type Conflict } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import {
  ChosenPlaybooksField,
  ClientSourceField,
  ConnectionIdField,
  GroupOfMoreSchema,
  NextClientIdField,
  TokenField,
} from '../operations/connection-fields.ts';
import { actedNow, linkedThrough } from '../operations/registry-access.ts';
import {
  askedAgainOf,
  moreAskedOf,
  noLongerNamed,
  scopesStillNamedOf,
  type AskedMore,
} from '../providers/asking-more.ts';
import { ConnectionSchema, connectionShown, scopesAddedTo } from '../registry/connection.ts';
import { isOpenConsent, type KeptWithLink } from '../registry/registry-lookup.ts';
import {
  isCoveredHere,
  nextClientOf,
  returnAddressFor,
  sourceOfAStartOf,
  sourcesFor,
  type Sources,
} from './consent-asking.ts';
import { listedOnThePageOf, ListedOnThePageFields, type LinkReading } from './linked-tools.ts';
import { SubjectTokenShownSchema, subjectTokenShownOf } from './subject-tokens-shown.ts';

const LinkSchema = Schema.Struct({ id: ConnectionIdField, token: TokenField });

export const LinkWithPlaybooksSchema = Schema.Struct({ ...LinkSchema.fields, playbooks: ChosenPlaybooksField });

const LinkedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  asked_scopes: ConnectionSchema.fields.asked_scopes.annotate({
    description:
      'The scopes the connection asked that its provider still asks or offers, and beside them those the consent this link starts asks, each with what a connection can do through it; empty where it asks none',
  }),
  link: Schema.Struct({
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
        "For a connection connected by consent, the source of the client a start would take now, by the rule the start takes it by: auto where it would begin through Auto's consent service, own where it runs under the organization's own OAuth client. Left out where the runtime has no client the way takes",
    }),
  ),
  return_address: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "For a connection under the organization's own OAuth client, the address the runtime sends its authorization server as redirect_uri, which that client registers as an authorized redirect URI",
    }),
  ),
  next_client_id: NextClientIdField,
  subject_token: Schema.optionalKey(SubjectTokenShownSchema),
  asked_by: Schema.optionalKey(
    CallingClientSchema.annotate({
      description:
        'The client the caller who asked for this link called through, add_connection for the link of an addition and reconnect_connection for a new one, as the token of that call named it: its client ID, its name and the domain of its client ID metadata document. Left out where the call named none, as a call with an API key, or with a session of a page, names none',
    }),
  ),
  ...ListedOnThePageFields,
}).annotate({
  identifier: 'LinkedConnection',
  description: 'The connection an open link names',
});

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

function askedAgainUnlessUncovered(
  connection: Linked,
  providers: LinkReading['providers'],
  sources: Sources,
): AskedOfTheLink {
  const { scope, scopeOfTheWay, says } = askedAgainOf(connection, providers);
  return {
    scope: scope === scopeOfTheWay || isCoveredHere(connection, scope, sources) ? scope : scopeOfTheWay,
    says,
  };
}

export function askedOfTheLink(
  { connection, link }: KeptWithLink,
  providers: LinkReading['providers'],
  sources: Sources,
): Result.Result<AskedOfTheLink, Conflict> {
  return link.more === undefined
    ? Result.succeed(askedAgainUnlessUncovered(connection, providers, sources))
    : askedOfALinkForMore(connection, providers, link.more);
}

function askedByOf({ link }: KeptWithLink) {
  return link.asked_by === undefined ? {} : { asked_by: link.asked_by };
}

function moreOfTheLink({ group }: AskedOfTheLink) {
  return group === undefined ? {} : { more: { name: group.name, for: group.for } };
}

function openConsentOf(kept: KeptWithLink, at: string) {
  return isOpenConsent(kept, at)
    ? { consent: { started_at: kept.consent.started_at, expires_at: kept.consent.expires_at } }
    : {};
}

export function defineReadLink(reading: LinkReading) {
  return defineHttpOperation('org', 'query', {
    name: 'read_link',
    title: 'Read link',
    description: [
      "Reads the connection an open link names, so Studio's page can show what the person is asked to approve.",
      'A link is open from when add_connection or reconnect_connection gave it until the connection is connected or removed, or a newer link replaces it.',
      "A link add_connection or reconnect_connection gave for a group of more names the group, and the connection's asked_scopes hold the scopes its consent asks beside those asked before.",
      "A connection under the organization's own OAuth client, its credential's client_source own, holds its credential's client_id once give_client gave the client, and until then the page asks for the client before the sign-in, showing return_address, the address the client registers as an authorized redirect URI, and answers next_client_id while it keeps a client given as its next.",
      'asked_by names the client the link was asked through, where the call that gave it named one.',
      'For an HTTP API given its OpenAPI document whole, tools names each tool that document offers, with its summary and its mark, read from the document the runtime keeps, or is null where that document cannot be read.',
      'For a server given by hand, ways lists the ways it offers, as its own metadata named them when the connection was added, and choose_way takes one of them. For a connection that exchanges a token Auto signs, subject_token names the issuer and the subject of that token, which its steps name, and where the issuer publishes its keys.',
      'A token that is unknown, used up or replaced is answered as not found.',
      'On a runtime that signs people in, only an admin of the organization may read it.',
    ].join(' '),
    route: { method: 'GET', path: '/connections/{id}/link/{token}' },
    body: { kind: 'none' },
    permittedBy: ['org:write'],
    connectionsManagement: true,
    inputSchema: LinkSchema,
    outputSchema: LinkedSchema,
    reasons: ['not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* (link) {
      const { kept } = yield* linkedThrough(reading, link);
      const acted = yield* actedNow;
      const sources = yield* sourcesFor(kept.connection, reading);
      const asked = yield* Effect.fromResult(askedOfTheLink(kept, reading.providers, sources));
      const source = sourceOfAStartOf(kept.connection, asked.scope, sources);
      const shown = connectionShown(kept.connection, null);
      return {
        ...shown,
        asked_scopes: scopesAddedTo(
          scopesStillNamedOf(kept.connection, reading.providers, shown.asked_scopes),
          asked.scope,
          asked.says,
        ),
        link: moreOfTheLink(asked),
        ...openConsentOf(kept, acted.at),
        ...source,
        ...returnAddressFor(kept.connection, reading),
        ...nextClientOf(kept),
        ...askedByOf(kept),
        ...subjectTokenShownOf(kept, reading.subjectTokens, (yield* OrgContext).org),
        ...(yield* listedOnThePageOf(kept, reading)),
      };
    }),
  });
}
