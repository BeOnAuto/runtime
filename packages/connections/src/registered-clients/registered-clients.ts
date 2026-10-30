import { alternatives } from '@on.auto/operations';
import { isPinnableTemplate, pinnedTemplateShape } from '@on.auto/providers';
import {
  isSameIssuer,
  type RegisteredClient,
  type RegisteredCredential,
  type TokenEndpointAuthMethod,
} from '@on.auto/tool-servers';
import { Option, Redacted, Schema } from 'effect';

import { holdsAReference, isReferenceHoldingField, misplacedReference } from './reference-fields.ts';

const tokenEndpointAuthMethods: readonly TokenEndpointAuthMethod[] = [
  'client_secret_basic',
  'client_secret_post',
  'private_key_jwt',
  'none',
];

const TokenEndpointAuthMethodSchema = Schema.Literals(tokenEndpointAuthMethods);

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const RegisteredClientFieldsSchema = Schema.Struct({
  issuers: Schema.Array(Schema.String)
    .check(
      Schema.isMinLength(1, {
        message: 'Expected at least one issuer, an authorization server the client is registered at',
      }),
    )
    .annotate({
      description:
        'The issuers of the authorization servers the client is registered at, each an https URL, or an http URL on a loopback address; one written with a placeholder, such as https://login.example.com/{tenant}, is kept as it is written',
    }),
  client_id: NamedSchema.annotate({ description: 'The client id the authorization servers issued' }),
  client_secret: Schema.optionalKey(
    Schema.String.annotate({ description: 'The client secret, as a reference such as ${EXAMPLE_CLIENT_SECRET}' }),
  ),
  private_key: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A private key in PEM that signs the client assertion, as a reference such as ${EXAMPLE_PRIVATE_KEY}',
    }),
  ),
  algorithm: Schema.optionalKey(
    NamedSchema.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
  token_endpoint_auth_method: Schema.optionalKey(
    TokenEndpointAuthMethodSchema.annotate({
      description:
        'How the client authenticates at the token endpoint where the metadata of the authorization server leaves the choice; chosen from the client and the metadata when left out',
    }),
  ),
  scopes: Schema.optionalKey(
    Schema.Array(NamedSchema)
      .check(
        Schema.isMinLength(1, {
          message: 'Expected at least one scope the client may ask; leave scopes out for a client that may ask any',
        }),
      )
      .annotate({
        description:
          "The scopes the client may ask at its issuers, each as a provider's way writes it: a way takes the first client at its issuer that names every scope the way asks. Named for each client where several clients serve one issuer, and left out for a client that may ask any",
      }),
  ),
});

type RegisteredClientFields = typeof RegisteredClientFieldsSchema.Type;

type CredentialKind = 'client_secret' | 'private_key' | 'public';

interface ClientIssue {
  readonly path: readonly PropertyKey[];
  readonly issue: string;
}

interface PlacedText {
  readonly path: readonly PropertyKey[];
  readonly text: string;
}

const methodsOfEachKind: Readonly<Record<CredentialKind, readonly TokenEndpointAuthMethod[]>> = {
  client_secret: ['client_secret_basic', 'client_secret_post'],
  private_key: ['private_key_jwt'],
  public: ['none'],
};

const kindsInWords: Readonly<Record<CredentialKind, string>> = {
  client_secret: 'a client with a client secret',
  private_key: 'a client with a private key',
  public: 'a public client',
};

function kindOf({ client_secret: clientSecret, private_key: privateKey }: RegisteredClientFields): CredentialKind {
  if (clientSecret !== undefined) {
    return 'client_secret';
  }
  return privateKey === undefined ? 'public' : 'private_key';
}

function textsAt(field: string, value: string | readonly string[]): readonly PlacedText[] {
  return typeof value === 'string'
    ? [{ path: [field], text: value }]
    : value.map((text, index) => ({ path: [field, index], text }));
}

function misplacedReferenceIssuesOf(client: RegisteredClientFields): readonly ClientIssue[] {
  return Object.entries(client)
    .flatMap(([field, value]: readonly [string, string | readonly string[]]) =>
      isReferenceHoldingField(field) ? [] : textsAt(field, value),
    )
    .flatMap(({ path, text }: PlacedText) => (holdsAReference(text) ? [{ path, issue: misplacedReference }] : []));
}

function issuerIssuesOf({ issuers }: RegisteredClientFields): readonly ClientIssue[] {
  return issuers.flatMap((issuer, index) =>
    isPinnableTemplate(issuer) ? [] : [{ path: ['issuers', index], issue: pinnedTemplateShape }],
  );
}

function credentialIssuesOf(client: RegisteredClientFields): readonly ClientIssue[] {
  const { client_secret: clientSecret, private_key: privateKey, algorithm } = client;
  if (clientSecret !== undefined && privateKey !== undefined) {
    return [
      {
        path: ['private_key'],
        issue: 'Expected client_secret or private_key, not both: a client authenticates with one',
      },
    ];
  }
  if (privateKey !== undefined && algorithm === undefined) {
    return [{ path: ['algorithm'], issue: 'Expected algorithm, the signing algorithm of private_key, such as RS256' }];
  }
  return privateKey === undefined && algorithm !== undefined
    ? [
        {
          path: ['algorithm'],
          issue: 'Expected no algorithm: it signs with private_key, which the client does not give',
        },
      ]
    : [];
}

function methodIssuesOf(client: RegisteredClientFields): readonly ClientIssue[] {
  const method = client.token_endpoint_auth_method;
  const kind = kindOf(client);
  const methods = methodsOfEachKind[kind];
  return method === undefined || methods.includes(method)
    ? []
    : [
        {
          path: ['token_endpoint_auth_method'],
          issue: `Expected ${alternatives(methods)}, which ${kindsInWords[kind]} authenticates with`,
        },
      ];
}

function writtenClientIssuesOf(client: RegisteredClientFields): readonly ClientIssue[] {
  const misplaced = misplacedReferenceIssuesOf(client);
  return misplaced.length > 0
    ? misplaced
    : [...issuerIssuesOf(client), ...credentialIssuesOf(client), ...methodIssuesOf(client)];
}

const scopesUnnamed =
  'Expected scopes, the scopes the client may ask, since another registered client names one of its issuers too, a trailing slash aside: a client that names none would serve every way there that no client before it covers, and a client after it never';

function sharesAnIssuer(client: RegisteredClientFields, other: RegisteredClientFields): boolean {
  return client.issuers.some((issuer) => other.issuers.some((named) => isSameIssuer(named, issuer)));
}

function unnamedScopeIssuesOf(clients: readonly RegisteredClientFields[]): readonly ClientIssue[] {
  return clients.flatMap((client, position) =>
    client.scopes === undefined && clients.some((other, index) => index !== position && sharesAnIssuer(client, other))
      ? [{ path: [position, 'scopes'], issue: scopesUnnamed }]
      : [],
  );
}

export const RegisteredClientsSchema = Schema.Array(
  RegisteredClientFieldsSchema.check(Schema.makeFilter(writtenClientIssuesOf)),
)
  .annotate({
    description:
      'The clients whoever runs the runtime registered at authorization servers, each with the issuers it is registered at, its client_id, and its client_secret, or its private_key with its algorithm, as a reference, or neither for a public client, and the scopes it may ask, which each client names where several serve one issuer',
  })
  .check(Schema.makeFilter((clients: readonly RegisteredClientFields[]) => unnamedScopeIssuesOf(clients)));

function credentialOf({
  client_secret: clientSecret,
  private_key: privateKey,
  algorithm,
}: RegisteredClientFields): RegisteredCredential {
  if (clientSecret !== undefined) {
    return { kind: 'client_secret', clientSecret: Redacted.make(clientSecret) };
  }
  return privateKey === undefined
    ? { kind: 'public' }
    : {
        kind: 'private_key',
        privateKey: Redacted.make(privateKey),
        algorithm: Option.getOrThrow(Option.fromNullishOr(algorithm)),
      };
}

export function registeredClientsOf(clients: readonly RegisteredClientFields[]): readonly RegisteredClient[] {
  return clients.map((client) => ({
    issuers: client.issuers,
    clientId: client.client_id,
    credential: credentialOf(client),
    tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? null,
    ...(client.scopes === undefined ? {} : { scopes: client.scopes }),
  }));
}

function secretOf(credential: RegisteredCredential): readonly Redacted.Redacted[] {
  if (credential.kind === 'client_secret') {
    return [credential.clientSecret];
  }
  return credential.kind === 'private_key' ? [credential.privateKey] : [];
}

export function registeredClientSecrets(clients: readonly RegisteredClient[]): readonly Redacted.Redacted[] {
  return clients.flatMap(({ credential }) => secretOf(credential));
}
