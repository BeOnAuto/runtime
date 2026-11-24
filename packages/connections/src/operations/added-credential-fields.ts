import { keyFieldNames, keyFields } from '@on.auto/providers';
import { WayOAuthClientSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import type { ConnectionType } from '../registry/connection-entry.ts';
import {
  CredentialFieldsSchema,
  CredentialKindSchema,
  credentialDescription,
  credentialFieldIssuesOf,
} from '../registry/credential.ts';
import { ServiceAccountChoiceSchema } from '../registry/exchange-credentials.ts';

const { variable, name, in: placement, scheme, issuer, client_id: clientId, scope } = CredentialFieldsSchema.fields;

export const AddedCredentialSchema = Schema.Struct({
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
  service_account: Schema.optionalKey(
    ServiceAccountChoiceSchema.annotate({
      description:
        "For a provider's token_exchange, managed for the way where the connection acts as a service account Auto creates for it; left out for the way of the company's own service account",
    }),
  ),
  instructions: Schema.optionalKey(
    keyFields.instructions(
      'For secret, Markdown without HTML the page shows the person: where the key is made, with a link, the plan or role and permissions it needs, and its format, as: Make a key under [Settings, API keys](https://app.example/keys) as an Admin, with read access. It is 40 characters.',
    ),
  ),
  key_page: Schema.optionalKey(keyFields.key_page('For secret, the https page where the person makes the key')),
  example: Schema.optionalKey(keyFields.example('For secret, the key with … in place of its characters')),
  pattern: Schema.optionalKey(
    keyFields.pattern(
      'For secret, the regular expression from ^ to $ the key matches, from its documentation; a key that misses it is kept',
    ),
  ),
}).annotate({ description: credentialDescription });

type AddedCredential = typeof AddedCredentialSchema.Type;

type ModeIssue = Schema.FilterIssue;

const placedByTheServer = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope', 'client_id'] as const;

const serviceAccountOfAnExchangeAlone =
  'Expected no service_account: only a token_exchange way acts as a service account Auto creates';

function serviceAccountIssuesOf(credential: AddedCredential | undefined): readonly ModeIssue[] {
  return credential?.service_account === undefined || credential.kind === 'token_exchange'
    ? []
    : [{ path: ['credential', 'service_account'], issue: serviceAccountOfAnExchangeAlone }];
}

const oauthClientOfConsentAlone =
  "Expected no oauth_client: only an authorization credential's consent runs under an OAuth client";

function oauthClientIssuesOf(credential: AddedCredential | undefined): readonly ModeIssue[] {
  return credential?.oauth_client === undefined || credential.kind === 'authorization'
    ? []
    : [{ path: ['credential', 'oauth_client'], issue: oauthClientOfConsentAlone }];
}

const consentOfAnApiByHand =
  'Expected another kind: an HTTP API given by hand takes no consent, since its document names no authorization server; name a provider, as search lists it, in provider';

const oauthClientOfAProvider =
  "Expected no oauth_client without provider: consent runs under the organization's own OAuth client at a provider, whose way says where to register it";

const serviceAccountOfAProvider =
  'Expected no service_account without provider: only a provider names a way that acts as a service account Auto creates';

function consentByHandIssuesOf(credential: AddedCredential, type: ConnectionType | undefined): readonly ModeIssue[] {
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

const kindsOfAProviderAlone: ReadonlySet<string> = new Set(['jwt_bearer', 'token_exchange']);

function ofAProviderAlone(kind: string): string {
  return `A server added by hand cannot use ${kind}. Add the connection from a provider that lists this way.`;
}

function credentialIssuesOf(
  credential: AddedCredential | undefined,
  type: ConnectionType | undefined,
): readonly ModeIssue[] {
  if (credential === undefined) {
    return [];
  }
  if (kindsOfAProviderAlone.has(credential.kind)) {
    return [{ path: ['credential', 'kind'], issue: ofAProviderAlone(credential.kind) }];
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

function unexplainedKeyIssuesOf(credential: AddedCredential | undefined): readonly ModeIssue[] {
  return credential?.kind === 'secret'
    ? explainedByTheAgent
        .filter((field) => credential[field] === undefined)
        .map((field) => ({ path: ['credential', field], issue: keyUnexplained[field] }))
    : [];
}

export function providerCredentialIssuesOf(credential: AddedCredential | undefined): readonly ModeIssue[] {
  return [...oauthClientIssuesOf(credential), ...serviceAccountIssuesOf(credential)];
}

export function handCredentialIssuesOf(
  credential: AddedCredential | undefined,
  type: ConnectionType | undefined,
): readonly ModeIssue[] {
  return [
    ...(credential?.oauth_client === undefined
      ? []
      : [{ path: ['credential', 'oauth_client'], issue: oauthClientOfAProvider }]),
    ...(credential?.service_account === undefined
      ? []
      : [{ path: ['credential', 'service_account'], issue: serviceAccountOfAProvider }]),
    ...credentialIssuesOf(credential, type),
    ...unexplainedKeyIssuesOf(credential),
  ];
}
