import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { ProviderRequests } from '../provider/provider-requests.ts';

export type Claims = Readonly<Record<string, unknown>>;

export interface FakeProviderOptions {
  readonly metadata?: Claims;
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
}

interface Granted {
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
  readonly options: FakeProviderOptions;
}

const fakeClientId = 'auto-runtime';

const fakeClientSecret = 'a-client-secret-of-the-test';

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
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'client_secret_jwt'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    ...options.metadata,
  };
}

function basicCredentialsOf(request: Readonly<Request>): readonly string[] {
  const authorization = String(request.headers.get('authorization'));
  const decoded = Buffer.from(authorization.replace(/^Basic /u, ''), 'base64').toString('utf8');
  return decoded.split(':').map((part) => decodeURIComponent(part.replaceAll('+', ' ')));
}

function isTheClientsAssertion(assertion: string, audience: readonly string[]): Promise<boolean> {
  const secret = new TextEncoder().encode(fakeClientSecret);
  return jwtVerify(assertion, secret, { issuer: fakeClientId, audience: [...audience] }).then(
    () => true,
    () => false,
  );
}

function isTheClient(
  request: Readonly<Request>,
  form: Readonly<URLSearchParams>,
  audience: readonly string[],
): Promise<boolean> {
  const assertion = form.get('client_assertion');
  if (assertion !== null) {
    return isTheClientsAssertion(assertion, audience);
  }
  const given = form.has('client_secret')
    ? [form.get('client_id'), form.get('client_secret')]
    : basicCredentialsOf(request);
  return Promise.resolve(given[0] === fakeClientId && given[1] === fakeClientSecret);
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function grantOf({ grants }: ProviderState, form: Readonly<URLSearchParams>): Granted | undefined {
  const grant = grants.taken(String(form.get('code')));
  const proven = challengeOf(String(form.get('code_verifier')));
  return grant?.redirectUri === form.get('redirect_uri') && grant.challenge === proven ? grant : undefined;
}

async function tokensOf(state: ProviderState, grant: Granted): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: state.issuer,
    sub: grant.subject,
    aud: fakeClientId,
    iat: now,
    exp: now + 300,
    nonce: grant.nonce,
  };
  const idToken = await state.keys.current().sign({ ...claims, ...state.options.idToken, ...grant.idToken });
  return json({ access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: idToken });
}

async function tokenAnswer(state: ProviderState, request: Readonly<Request>): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  if (!(await isTheClient(request, form, [state.issuer, `${state.base}/token`]))) {
    return json({ error: 'invalid_client' }, 401);
  }
  const { tokenError } = state.options;
  const grant = tokenError === undefined ? grantOf(state, form) : undefined;
  return grant === undefined ? json({ error: tokenError ?? 'invalid_grant' }, 400) : tokensOf(state, grant);
}

function answerOf(state: ProviderState): FakeProvider['answer'] {
  return (request) => {
    const path = request.url.slice(state.base.length);
    if (path === '/token' && request.method === 'POST') {
      return tokenAnswer(state, request);
    }
    const documents = new Map<string, () => unknown>([
      ['/.well-known/openid-configuration', () => metadataOf(state)],
      ['/jwks', () => ({ keys: [state.keys.read().jwk] })],
    ]);
    const found = documents.get(path)?.();
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
  const state: ProviderState = { issuer, base, grants: grantsKept(), keys, options };
  const answer = answerOf(state);
  return {
    issuer,
    clientId: fakeClientId,
    clientSecret: fakeClientSecret,
    answer,
    requests: {
      fetch: (request) =>
        request.url.startsWith(`${base}/`) ? answer(request) : Promise.reject(new TypeError('fetch failed')),
    },
    signedIn: signedInBy(state),
    refused: (authorizationUrl, error) => backTo(issuer, authorizationUrl, { error }),
    rotate: keys.rotate,
    keySetReads: keys.reads,
  };
}
