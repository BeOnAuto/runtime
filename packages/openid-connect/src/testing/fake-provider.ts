import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

import { authorizationServerMetadataAddressOf } from '../provider/provider-metadata.ts';
import type { ProviderRequests } from '../provider/provider-requests.ts';
import {
  fakeClientId,
  fakeClients,
  fakeClientSecret,
  type ClientsAnswering,
  type FakeClients,
} from './fake-clients.ts';

export type Claims = Readonly<Record<string, unknown>>;

export interface FakeProviderOptions extends ClientsAnswering {
  readonly metadata?: Claims;
  readonly authorizationServerMetadata?: Claims;
  readonly idToken?: Claims;
  readonly tokenError?: string;
}

export interface FakeProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly answer: (request: Readonly<Request>) => Promise<Response>;
  readonly requests: ProviderRequests;
  readonly signedIn: (authorizationUrl: string, subject: string, idToken?: Claims) => string;
  readonly refused: (authorizationUrl: string, error: string) => string;
  readonly rotate: () => void;
  readonly keySetReads: () => number;
  readonly withdraw: FakeClients['withdraw'];
  readonly registrationsAsked: FakeClients['registrationsAsked'];
}

interface Granted {
  readonly clientId: string;
  readonly subject: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly redirectUri: string;
  readonly idToken: Claims;
}

interface SigningKey {
  readonly jwk: Claims;
  readonly sign: (claims: Claims) => Promise<string>;
}

interface Grants {
  readonly granted: (code: string, grant: Granted) => void;
  readonly taken: (code: string) => Granted | undefined;
}

interface Keys {
  readonly current: () => SigningKey;
  readonly read: () => SigningKey;
  readonly rotate: () => void;
  readonly reads: () => number;
}

interface ProviderState {
  readonly issuer: string;
  readonly base: string;
  readonly grants: Grants;
  readonly keys: Keys;
  readonly clients: FakeClients;
  readonly options: FakeProviderOptions;
}

function keyOf(generation: number): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const kid = `es256-${generation}`;
  return {
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' },
    sign: (claims) => new SignJWT({ ...claims }).setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' }).sign(privateKey),
  };
}

function grantsKept(): Grants {
  const grants = new Map<string, Granted>();
  return {
    granted: (code, grant) => {
      grants.set(code, grant);
    },
    taken: (code) => {
      const grant = grants.get(code);
      grants.delete(code);
      return grant;
    },
  };
}

function keysKept(): Keys {
  const kept = { current: keyOf(1), generation: 1, reads: 0 };
  return {
    current: () => kept.current,
    read: () => {
      kept.reads += 1;
      return kept.current;
    },
    rotate: () => {
      kept.generation += 1;
      kept.current = keyOf(kept.generation);
    },
    reads: () => kept.reads,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function metadataOf({ issuer, base, options }: ProviderState): Claims {
  return {
    issuer,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'client_secret_jwt'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    ...options.metadata,
  };
}

function authorizationServerMetadataOf({ issuer, base, options }: ProviderState): Claims | undefined {
  const { authorizationServerMetadata } = options;
  return authorizationServerMetadata === undefined
    ? undefined
    : { issuer, registration_endpoint: `${base}/register`, ...authorizationServerMetadata };
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function grantOf({ grants }: ProviderState, form: Readonly<URLSearchParams>, clientId: string): Granted | undefined {
  const grant = grants.taken(String(form.get('code')));
  const proven = challengeOf(String(form.get('code_verifier')));
  const issuedToIt = grant?.clientId === clientId && grant.redirectUri === form.get('redirect_uri');
  return issuedToIt && grant.challenge === proven ? grant : undefined;
}

async function tokensOf(state: ProviderState, grant: Granted): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: state.issuer,
    sub: grant.subject,
    aud: grant.clientId,
    iat: now,
    exp: now + 300,
    nonce: grant.nonce,
  };
  const idToken = await state.keys.current().sign({ ...claims, ...state.options.idToken, ...grant.idToken });
  return json({ access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: idToken });
}

async function tokenAnswer(state: ProviderState, request: Readonly<Request>): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const clientId = await state.clients.authenticated(request, form, [state.issuer, `${state.base}/token`]);
  if (clientId === undefined) {
    return state.clients.refusedClient();
  }
  const { tokenError } = state.options;
  const grant = tokenError === undefined ? grantOf(state, form, clientId) : undefined;
  return grant === undefined ? json({ error: tokenError ?? 'invalid_grant' }, 400) : tokensOf(state, grant);
}

function answerOf(state: ProviderState): FakeProvider['answer'] {
  return (request) => {
    const path = request.url.slice(state.base.length);
    const posted = new Map<string, () => Promise<Response>>([
      ['/token', () => tokenAnswer(state, request)],
      ['/register', () => state.clients.registered(request)],
    ]).get(path);
    if (posted !== undefined && request.method === 'POST') {
      return posted();
    }
    const documents = new Map<string, () => unknown>([
      [`${state.base}/.well-known/openid-configuration`, () => metadataOf(state)],
      [`${state.base}/jwks`, () => ({ keys: [state.keys.read().jwk] })],
      [authorizationServerMetadataAddressOf(state.issuer), () => authorizationServerMetadataOf(state)],
    ]);
    const found = documents.get(request.url)?.();
    return Promise.resolve(found === undefined ? json({ error: 'not_found' }, 404) : json(found));
  };
}

function backTo(issuer: string, authorizationUrl: string, answered: Readonly<Record<string, string>>): string {
  const asked = new URL(authorizationUrl).searchParams;
  return new URLSearchParams({ ...answered, state: String(asked.get('state')), iss: issuer }).toString();
}

function signedInBy({ issuer, grants }: ProviderState): FakeProvider['signedIn'] {
  return (authorizationUrl, subject, idToken = {}) => {
    const asked = new URL(authorizationUrl).searchParams;
    const code = randomUUID();
    grants.granted(code, {
      clientId: String(asked.get('client_id')),
      subject,
      nonce: String(asked.get('nonce')),
      challenge: String(asked.get('code_challenge')),
      redirectUri: String(asked.get('redirect_uri')),
      idToken,
    });
    return backTo(issuer, authorizationUrl, { code });
  };
}

export function fakeProvider(issuer: string, options: FakeProviderOptions = {}): FakeProvider {
  const base = issuer.replace(/\/$/u, '');
  const keys = keysKept();
  const clients = fakeClients(options);
  const state: ProviderState = { issuer, base, grants: grantsKept(), keys, clients, options };
  const answer = answerOf(state);
  const origin = new URL(issuer).origin;
  return {
    issuer,
    clientId: fakeClientId,
    clientSecret: fakeClientSecret,
    answer,
    requests: {
      fetch: (request) =>
        request.url.startsWith(`${origin}/`) ? answer(request) : Promise.reject(new TypeError('fetch failed')),
    },
    signedIn: signedInBy(state),
    refused: (authorizationUrl, error) => backTo(issuer, authorizationUrl, { error }),
    rotate: keys.rotate,
    keySetReads: keys.reads,
    withdraw: clients.withdraw,
    registrationsAsked: clients.registrationsAsked,
  };
}
