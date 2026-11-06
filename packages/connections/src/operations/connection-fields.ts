import { PlaybookIdSchema } from '@on.auto/operations';
import { keyFieldNames, keyFields } from '@on.auto/providers';
import { ClientSourceSchema, WayOAuthClientSchema, givenByTheProvider } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from '../registry/connection-entry.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import {
  CredentialFieldsSchema,
  CredentialKindSchema,
  credentialDescription,
  credentialFieldIssuesOf,
} from '../registry/credential.ts';

export const ClientSourceField = ClientSourceSchema;

export const ExpiresAtField = Schema.String.annotate({ description: 'When the link expires, in ISO 8601 UTC' });

export const AddedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  connect: Schema.optionalKey(
    Schema.Struct({
      url: Schema.String.annotate({ description: "Studio's page, where the person approves the connection" }),
      expires_at: ExpiresAtField,
    }).annotate({ description: 'The link that approves the connection, while it lasts and is not used up' }),
  ),
  link_ran_out: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'Answered after the link: the link offered ran out unused, so the connection stands as it was',
    }),
  ),
  link_replaced: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description:
        'Answered after the link: a newer link, still open, replaced the link offered, so the person who added the connection opens the newest',
    }),
  ),
}).annotate({
  identifier: 'AddedConnection',
  description: 'The connection, and the link that approves it while there is one to open',
});

export type AddedConnection = typeof AddedSchema.Type;

export const GroupOfMoreSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name add_connection and reconnect_connection take as more' }),
  for: Schema.String.annotate({ description: "What it is for, in the person's words" }),
}).annotate({ description: 'A group of scopes a later consent may add' });

export type GroupOfMore = typeof GroupOfMoreSchema.Type;

const { variable, name, in: placement, scheme, issuer, client_id: clientId, scope } = CredentialFieldsSchema.fields;

const AddedCredentialSchema = Schema.Struct({
  kind: CredentialKindSchema,
  variable,
  name,
  in: placement,
  scheme,
  issuer: Schema.optionalKey(
    issuer.schema.annotate({ description: 'For client_credentials, the https URL of the authorization server' }),
  ),
  client_id: Schema.optionalKey(
    clientId.schema.annotate({ description: 'For client_credentials, the id of the client, else given on the page' }),
  ),
  scope: Schema.optionalKey(
    scope.schema.annotate({
      description: 'For client_credentials, the scopes, separated by spaces, none when left out',
    }),
  ),
  oauth_client: Schema.optionalKey(
    WayOAuthClientSchema.annotate({
      description:
        "For a provider's authorization, own for the organization's own OAuth client, its client ID and secret given on the page; the default where the way takes no client here",
    }),
  ),
  instructions: Schema.optionalKey(
    keyFields.instructions(
      'For secret, Markdown without HTML the page shows the person: where the key is made, with a link, the plan or role and permissions it needs, and its format, as: Make a key under [Settings, API keys](https://acme.example/keys) as an Admin, with read access. It starts with `acme_`.',
    ),
  ),
  key_page: Schema.optionalKey(keyFields.key_page('For secret, the https page where the person makes the key')),
  example: Schema.optionalKey(
    keyFields.example('For secret, the key with … in place of its characters, such as acme_…'),
  ),
  pattern: Schema.optionalKey(
    keyFields.pattern(
      'For secret, the regular expression from ^ to $ the key matches, such as ^acme_\\w+$; a key that misses it is kept',
    ),
  ),
}).annotate({ description: credentialDescription });

const AdditionFieldsSchema = Schema.Struct({
  name: Schema.optionalKey(
    Schema.String.annotate({ description: 'The name a function gives the server, in lowercase and hyphens' }),
  ),
  provider: Schema.optionalKey(Schema.String.annotate({ description: 'A provider to connect, by its name' })),
  placeholders: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({ description: "With provider, its placeholders' values" }),
  ),
  type: Schema.optionalKey(ConnectionTypeSchema),
  entry: Schema.optionalKey(ConnectionEntrySchema),
  credential: Schema.optionalKey(AddedCredentialSchema),
  more: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A group of more the provider's way offers, by name, as search lists under providers; its scopes are asked on the page beside the first consent's. None when left out, and an addition by hand takes none",
    }),
  ),
});

export type AdditionGiven = typeof AdditionFieldsSchema.Type;

type ModeIssue = Schema.FilterIssue;

const givenByHand = ['name', 'type', 'entry'] as const;

const credentialOfAnApiByHand = 'Expected credential, which an HTTP API given by hand takes, or provider';

const serverFields = ['url', 'document', 'base_url', 'headers', 'query_params', 'request_id'] as const;

const placedByTheProvider = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope', ...keyFieldNames] as const;

const placedByTheServer = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope', 'client_id'] as const;

function providerModeIssuesOf({ type, entry = {}, credential }: AdditionGiven): readonly ModeIssue[] {
  return [
    ...(type === undefined ? [] : [{ path: ['type'], issue: 'Expected no type: the provider gives it' }]),
    ...serverFields
      .filter((field) => entry[field] !== undefined)
      .map((field) => ({ path: ['entry', field], issue: givenByTheProvider(field) })),
    ...placedByTheProvider
      .filter((field) => credential?.[field] !== undefined)
      .map((field) => ({
        path: ['credential', field],
        issue: `Expected no ${field}: the provider gives the credential but its kind`,
      })),
    ...(credential?.client_id === undefined
      ? []
      : [
          {
            path: ['credential', 'client_id'],
            issue: 'Expected no client_id: the person gives the client id on the page',
          },
        ]),
    ...oauthClientIssuesOf(credential),
  ];
}

const oauthClientOfConsentAlone =
  "Expected no oauth_client: only an authorization credential's consent runs under an OAuth client";

function oauthClientIssuesOf(credential: AdditionGiven['credential']): readonly ModeIssue[] {
  return credential?.oauth_client === undefined || credential.kind === 'authorization'
    ? []
    : [{ path: ['credential', 'oauth_client'], issue: oauthClientOfConsentAlone }];
}

const consentOfAnApiByHand =
  'Expected another kind: an HTTP API given by hand takes no consent, since its document names no authorization server; name a provider, as search lists it, in provider';

const oauthClientOfAProvider =
  "Expected no oauth_client without provider: consent runs under the organization's own OAuth client at a provider, whose way says where to register it";

type AddedCredential = NonNullable<AdditionGiven['credential']>;

function consentByHandIssuesOf(credential: AddedCredential, type: AdditionGiven['type']): readonly ModeIssue[] {
  if (type === 'openapi') {
    return [{ path: ['credential', 'kind'], issue: consentOfAnApiByHand }];
  }
  return [
    ...placedByTheServer
      .filter((field) => credential[field] !== undefined)
      .map((field) => ({
        path: ['credential', field],
        issue: `Expected no ${field}: the server names its authorization server itself`,
      })),
    ...keyFieldNames
      .filter((field) => credential[field] !== undefined)
      .map((field) => ({
        path: ['credential', field],
        issue: `Expected no ${field}: the person signs in at the server's authorization server, so no key is made`,
      })),
  ];
}

function missingCredentialIssuesOf({ credential, type }: AdditionGiven): readonly ModeIssue[] {
  return credential === undefined && type !== 'mcp' ? [{ path: ['credential'], issue: credentialOfAnApiByHand }] : [];
}

function credentialIssuesOf({ credential, type }: AdditionGiven): readonly ModeIssue[] {
  if (credential === undefined) {
    return [];
  }
  return credential.kind === 'authorization'
    ? consentByHandIssuesOf(credential, type)
    : credentialFieldIssuesOf(credential).map(({ path, issue }) => ({ path: ['credential', ...path], issue }));
}

const keyUnexplained: Readonly<Record<'instructions' | 'key_page', string>> = {
  instructions:
    'Expected instructions, which a secret credential given by hand takes: in Markdown, where the person makes the key, with a link to that page, the plan or role it needs, the permissions it needs and its format',
  key_page:
    'Expected key_page, which a secret credential given by hand takes: the https address of the page where the person makes the key',
};

const explainedByTheAgent = ['instructions', 'key_page'] as const;

function unexplainedKeyIssuesOf({ credential }: AdditionGiven): readonly ModeIssue[] {
  return credential?.kind === 'secret'
    ? explainedByTheAgent
        .filter((field) => credential[field] === undefined)
        .map((field) => ({ path: ['credential', field], issue: keyUnexplained[field] }))
    : [];
}

const moreOfAnAdditionByHand =
  'Expected no more without provider: an addition by hand offers no group of more, since only a provider names one';

function handModeIssuesOf(given: AdditionGiven): readonly ModeIssue[] {
  const { placeholders } = given;
  return [
    ...givenByHand
      .filter((field) => given[field] === undefined)
      .map((field) => ({ path: [field], issue: `Expected ${field}, which a server given by hand takes, or provider` })),
    ...missingCredentialIssuesOf(given),
    ...(placeholders === undefined
      ? []
      : [{ path: ['placeholders'], issue: 'Expected no placeholders without provider' }]),
    ...(given.more === undefined ? [] : [{ path: ['more'], issue: moreOfAnAdditionByHand }]),
    ...(given.credential?.oauth_client === undefined
      ? []
      : [{ path: ['credential', 'oauth_client'], issue: oauthClientOfAProvider }]),
    ...credentialIssuesOf(given),
    ...unexplainedKeyIssuesOf(given),
  ];
}

export const AdditionSchema = AdditionFieldsSchema.check(
  Schema.makeFilter((given: AdditionGiven) =>
    given.provider === undefined ? handModeIssuesOf(given) : providerModeIssuesOf(given),
  ),
);

export const ConnectionIdField = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The id of the connection',
});

export const PlaybooksField = Schema.NullOr(
  Schema.Array(PlaybookIdSchema).check(
    Schema.isMinLength(1, { message: 'Expected at least one playbook id, or null for every playbook' }),
  ),
).annotate({
  description:
    'The playbooks that may use the connection, by id, or null for every playbook of the org, those made later among them',
});

export const TokenField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  description: 'The token of the link add_connection or reconnect_connection gave',
});

export const NextClientIdField = Schema.optionalKey(
  Schema.String.annotate({
    description:
      "For a connection under the organization's own OAuth client, the client ID given while it holds tokens, which its next sign-in takes and which it runs under once that sign-in connects it",
  }),
);
