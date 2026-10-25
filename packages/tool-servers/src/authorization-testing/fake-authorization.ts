import { json } from './authorization-answers.ts';
import { fakeClients, type ClientRegistration, type FakeClients } from './fake-clients.ts';
import { fakeGrants, fakeTokens, type TokenRequest } from './fake-grants.ts';

export interface FakeAuthorization {
  readonly answer: (request: Readonly<Request>) => Promise<Response> | undefined;
  readonly accepts: (token: string) => boolean;
  readonly tokenRequests: () => number;
  readonly revokeEveryToken: () => void;
}

type Route = readonly [string, (request: Readonly<Request>) => Promise<Response>];

type Granted = (asked: TokenRequest) => Response;

interface Asking {
  readonly request: Readonly<Request>;
  readonly form: Readonly<URLSearchParams>;
  readonly requested: number;
}

const methodsOfAuthentication = ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'none'];

function openIdFields(origin: string) {
  return {
    jwks_uri: `${origin}/jwks`,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

function endpointsOriginOf(origin: string, { endpointHost }: ClientRegistration): string {
  if (endpointHost === undefined) {
    return origin;
  }
  const moved = new URL(origin);
  moved.hostname = endpointHost;
  return moved.origin;
}

function methodsOf({ takesBasicSecrets }: ClientRegistration): readonly string[] {
  return takesBasicSecrets === false
    ? methodsOfAuthentication.filter((method) => method !== 'client_secret_basic')
    : methodsOfAuthentication;
}

function metadataOf(origin: string, registration: ClientRegistration) {
  const at = endpointsOriginOf(origin, registration);
  const methods = methodsOf(registration);
  return {
    issuer: registration.issuer ?? origin,
    authorization_endpoint: `${at}/authorize`,
    token_endpoint: `${at}/token`,
    revocation_endpoint: `${at}/revoke`,
    ...(registration.dynamicRegistration === true ? { registration_endpoint: `${at}/register` } : {}),
    response_types_supported: ['code'],
    grant_types_supported: ['client_credentials', 'authorization_code', 'refresh_token'],
    code_challenge_methods_supported: registration.challengeMethods ?? ['S256'],
    token_endpoint_auth_methods_supported: methods,
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    ...(registration.listsRevocationMethods === false ? {} : { revocation_endpoint_auth_methods_supported: methods }),
    authorization_response_iss_parameter_supported: true,
    ...(registration.clientMetadataDocuments === true ? { client_id_metadata_document_supported: true } : {}),
    ...(registration.scopesSupported === undefined ? {} : { scopes_supported: registration.scopesSupported }),
  };
}

const metadataPaths = [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];

function unpublished(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

function documentRoutesOf(origin: string, registration: ClientRegistration): readonly Route[] {
  if (registration.publishesMetadata === false) {
    return metadataPaths.map((path): Route => [path, unpublished]);
  }
  const metadata = metadataOf(origin, registration);
  const resource = {
    resource: registration.protectedResource ?? `${origin}/mcp`,
    authorization_servers: [registration.authorizationServer ?? origin],
    ...(registration.protectedScopes === undefined ? {} : { scopes_supported: registration.protectedScopes }),
  };
  return [
    ['/.well-known/oauth-protected-resource/mcp', () => Promise.resolve(json(resource))],
    registration.openIdConnect === true
      ? ['/.well-known/openid-configuration', () => Promise.resolve(json({ ...metadata, ...openIdFields(origin) }))]
      : ['/.well-known/oauth-authorization-server', () => Promise.resolve(json(metadata))],
  ];
}

async function asClient(clients: FakeClients, asking: Asking, granted: Granted): Promise<Response> {
  const { request, form, requested } = asking;
  const client = await clients.authenticated(request, form);
  return client === undefined ? json({ error: 'invalid_client' }, 401) : granted({ form, client, requested });
}

async function formOf(request: Readonly<Request>): Promise<URLSearchParams> {
  return new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
}

export function fakeAuthorization(origin: string, registration: ClientRegistration): FakeAuthorization {
  const clients = fakeClients(registration);
  const tokens = fakeTokens(registration);
  const grants = fakeGrants(registration.issuer ?? origin, registration, clients, tokens);
  let requested = 0;
  const grantsByType: ReadonlyMap<string, Granted> = new Map([
    ['client_credentials', grants.clientCredentials],
    ['authorization_code', grants.exchange],
    ['refresh_token', grants.refresh],
  ]);
  const token = async (request: Readonly<Request>): Promise<Response> => {
    requested += 1;
    const form = await formOf(request);
    const granted = grantsByType.get(form.get('grant_type') ?? '');
    return granted === undefined
      ? json({ error: 'unsupported_grant_type' }, 400)
      : asClient(clients, { request, form, requested }, granted);
  };
  const revoke = async (request: Readonly<Request>): Promise<Response> =>
    asClient(clients, { request, form: await formOf(request), requested }, grants.revoke);
  const routes = new Map<string, (request: Readonly<Request>) => Promise<Response>>([
    ['/token', token],
    ['/authorize', grants.authorize],
    ['/revoke', revoke],
    ...(registration.dynamicRegistration === true ? [['/register', clients.register] as const] : []),
    ...documentRoutesOf(origin, registration),
  ]);
  return {
    answer: (request) => routes.get(new URL(request.url).pathname)?.(request),
    accepts: tokens.accepts,
    tokenRequests: () => requested,
    revokeEveryToken: tokens.revokeEveryToken,
  };
}
