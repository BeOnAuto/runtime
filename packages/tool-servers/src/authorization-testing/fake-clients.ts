import { Buffer } from 'node:buffer';
import { verify } from 'node:crypto';

import { Option, Schema } from 'effect';

import { json } from './authorization-answers.ts';

export interface ClientRegistration {
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly publicKey?: string;
  readonly expiresInSeconds: number | null;
  readonly issuer?: string;
  readonly authorizationServers?: readonly string[];
  readonly protectedResource?: string;
  readonly resourceMetadataPath?: string;
  readonly openIdConnect?: boolean;
  readonly redirectUris?: readonly string[];
  readonly rotatesRefreshTokens?: boolean;
  readonly clientMetadataDocuments?: boolean;
  readonly dynamicRegistration?: boolean;
  readonly challengeMethods?: readonly string[];
  readonly takesNoChallenge?: boolean;
  readonly grantedScope?: string;
  readonly issuesRefreshTokens?: boolean;
  readonly namesTokenType?: boolean;
  readonly publishesMetadata?: boolean;
  readonly endpointHost?: string;
  readonly takesBasicSecrets?: boolean;
  readonly takesPublicClientsAlone?: boolean;
  readonly listsRevocationMethods?: boolean;
  readonly scopesSupported?: readonly string[];
  readonly protectedScopes?: readonly string[];
  readonly requiredScopes?: readonly string[];
  readonly refusesRegistration?: boolean;
  readonly registeredClientId?: string;
  readonly registrationSecretSeconds?: number;
  readonly registrationsBeforeTheLimit?: number;
  readonly registrationRetryAfter?: string;
}

export interface KnownClient {
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly publicKey: string | undefined;
  readonly redirectUris: readonly string[];
}

export interface FakeClients {
  readonly known: (clientId: string) => Promise<KnownClient | undefined>;
  readonly authenticated: (
    request: Readonly<Request>,
    form: Readonly<URLSearchParams>,
  ) => Promise<KnownClient | undefined>;
  readonly register: (request: Readonly<Request>) => Promise<Response>;
}

const decodeClaims = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ sub: Schema.String })));

const decodeDocument = Schema.decodeUnknownOption(
  Schema.Struct({ client_id: Schema.String, redirect_uris: Schema.Array(Schema.String) }),
);

const decodeRegistration = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      redirect_uris: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      token_endpoint_auth_method: Schema.optionalKey(
        Schema.Literals(['none', 'client_secret_basic', 'client_secret_post']),
      ),
    }),
  ),
);

function basicCredentialsOf(request: Readonly<Request>): readonly [string, string] | undefined {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) {
    return undefined;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return [decoded.slice(0, colon), decoded.slice(colon + 1)];
}

function partsOf(assertion: string): readonly [string, string, string] {
  const [header = '', claims = '', signature = ''] = assertion.split('.');
  return [header, claims, signature];
}

function subjectOf(assertion: string): string {
  return decodeClaims(Buffer.from(partsOf(assertion)[1], 'base64url').toString('utf8')).sub;
}

function isSignedBy(assertion: string, publicKey: string): boolean {
  const [header, claims, signature] = partsOf(assertion);
  return verify('sha256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'));
}

export function isPublic(client: KnownClient): boolean {
  return client.clientSecret === undefined && client.publicKey === undefined;
}

function registeredClientOf({ clientId, clientSecret, publicKey, redirectUris = [] }: ClientRegistration): KnownClient {
  return { clientId, clientSecret, publicKey, redirectUris };
}

async function documentedClient(clientId: string): Promise<KnownClient | undefined> {
  const answer = await fetch(clientId);
  const document = answer.ok ? decodeDocument(await answer.json()) : Option.none();
  return Option.getOrUndefined(
    Option.flatMap(document, ({ client_id: named, redirect_uris: redirectUris }) =>
      named === clientId
        ? Option.some({ clientId, clientSecret: undefined, publicKey: undefined, redirectUris })
        : Option.none(),
    ),
  );
}

function withSecret(client: KnownClient | undefined, secret: string): KnownClient | undefined {
  return client?.clientSecret !== undefined && client.clientSecret === secret ? client : undefined;
}

interface Registry {
  readonly registration: ClientRegistration;
  readonly clients: Map<string, KnownClient>;
  readonly registered: Map<string, KnownClient>;
}

async function documentedIn({ registration, clients }: Registry, clientId: string): Promise<KnownClient | undefined> {
  if (registration.clientMetadataDocuments !== true || !URL.canParse(clientId)) {
    return undefined;
  }
  const client = await documentedClient(clientId);
  if (client !== undefined) {
    clients.set(clientId, client);
  }
  return client;
}

async function knownIn(registry: Registry, clientId: string): Promise<KnownClient | undefined> {
  return registry.clients.get(clientId) ?? (await documentedIn(registry, clientId));
}

async function assertedIn(registry: Registry, assertion: string): Promise<KnownClient | undefined> {
  const client = await knownIn(registry, subjectOf(assertion));
  return client?.publicKey !== undefined && isSignedBy(assertion, client.publicKey) ? client : undefined;
}

async function namedIn(registry: Registry, form: Readonly<URLSearchParams>): Promise<KnownClient | undefined> {
  const client = await knownIn(registry, form.get('client_id') ?? '');
  const secret = form.get('client_secret');
  if (secret !== null) {
    return withSecret(client, secret);
  }
  return client !== undefined && isPublic(client) ? client : undefined;
}

async function credentialedIn(
  registry: Registry,
  request: Readonly<Request>,
  form: Readonly<URLSearchParams>,
): Promise<KnownClient | undefined> {
  const basic = basicCredentialsOf(request);
  if (basic !== undefined) {
    return registry.registration.takesBasicSecrets === false
      ? undefined
      : withSecret(await knownIn(registry, basic[0]), basic[1]);
  }
  const assertion = form.get('client_assertion');
  return assertion === null ? namedIn(registry, form) : assertedIn(registry, assertion);
}

async function authenticatedIn(
  registry: Registry,
  request: Readonly<Request>,
  form: Readonly<URLSearchParams>,
): Promise<KnownClient | undefined> {
  const client = await credentialedIn(registry, request, form);
  return registry.registration.takesPublicClientsAlone === true && client !== undefined && !isPublic(client)
    ? undefined
    : client;
}

function secretEndIn(
  { registrationSecretSeconds }: ClientRegistration,
  clientSecret: string | undefined,
): { readonly client_secret_expires_at?: number } {
  if (registrationSecretSeconds === undefined) {
    return clientSecret === undefined ? {} : { client_secret_expires_at: 0 };
  }
  return { client_secret_expires_at: Math.floor(Date.now() / 1000) + registrationSecretSeconds };
}

const rateLimited = { error: 'rate_limited', error_description: 'Too many requests. Please try again later.' };

function isPastTheLimit({ registration, registered }: Registry): boolean {
  const { registrationsBeforeTheLimit: limit } = registration;
  return limit !== undefined && registered.size >= limit;
}

function rateLimitedBy({ registrationRetryAfter: retryAfter }: ClientRegistration): Response {
  const answer = json(rateLimited, 429);
  if (retryAfter !== undefined) {
    answer.headers.set('retry-after', retryAfter);
  }
  return answer;
}

async function registeredIn(registry: Registry, request: Readonly<Request>): Promise<Response> {
  const { registration, clients, registered } = registry;
  if (isPastTheLimit(registry)) {
    return rateLimitedBy(registration);
  }
  const asked = decodeRegistration(await request.text());
  if (Option.isNone(asked) || registration.refusesRegistration === true) {
    return json({ error: 'invalid_client_metadata', error_description: 'Expected redirect_uris' }, 400);
  }
  const method = asked.value.token_endpoint_auth_method ?? 'client_secret_basic';
  const clientId = registration.registeredClientId ?? `registered-${String(registered.size + 1)}`;
  const clientSecret = method === 'none' ? undefined : `registered-secret-${crypto.randomUUID()}`;
  const client = { clientId, clientSecret, publicKey: undefined, redirectUris: asked.value.redirect_uris };
  registered.set(clientId, client);
  clients.set(clientId, client);
  return json(
    {
      client_id: clientId,
      ...(clientSecret === undefined ? {} : { client_secret: clientSecret }),
      ...secretEndIn(registration, clientSecret),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: asked.value.redirect_uris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  );
}

export function fakeClients(registration: ClientRegistration): FakeClients {
  const registry: Registry = {
    registration,
    clients: new Map([[registration.clientId, registeredClientOf(registration)]]),
    registered: new Map(),
  };
  return {
    known: (clientId) => knownIn(registry, clientId),
    authenticated: (request, form) => authenticatedIn(registry, request, form),
    register: (request) => registeredIn(registry, request),
  };
}
