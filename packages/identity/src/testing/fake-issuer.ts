import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { SignJWT } from 'jose';

export type FakeSigner = 'RS256' | 'PS256' | 'ES256' | 'EdDSA';

export type Claims = Readonly<Record<string, unknown>>;

export interface Signing {
  readonly signer?: FakeSigner;
  readonly kid?: string | null;
  readonly typ?: string | null;
}

export interface FakeClient {
  readonly secret: string;
  readonly claims: Claims;
}

export interface FakeIssuerOptions {
  readonly metadata?: Claims;
  readonly clients?: Readonly<Record<string, FakeClient>>;
}

export interface FakeIssuer {
  readonly issuer: string;
  readonly answer: (request: Readonly<Request>) => Promise<Response>;
  readonly sign: (claims: Claims, signing?: Signing) => Promise<string>;
  readonly session: (page: string, claims?: Claims) => Promise<string>;
  readonly rotate: () => void;
  readonly keySetReads: () => number;
}

interface FakeKey {
  readonly kid: string;
  readonly jwk: Claims;
  readonly sign: (
    payload: Claims,
    header: { readonly kid: string | null; readonly typ: string | null },
  ) => Promise<string>;
}

interface KeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

const pairs: Readonly<Record<FakeSigner, () => KeyPair>> = {
  RS256: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
  PS256: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
  ES256: () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  EdDSA: () => generateKeyPairSync('ed25519'),
};

function keyOf(signer: FakeSigner, generation: number): FakeKey {
  const { publicKey, privateKey } = pairs[signer]();
  const kid = `${signer.toLowerCase()}-${generation}`;
  return {
    kid,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: signer, use: 'sig' },
    sign: (payload, { kid: named, typ }) =>
      new SignJWT({ ...payload })
        .setProtectedHeader({
          alg: signer,
          ...(named === null ? {} : { kid: named }),
          ...(typ === null ? {} : { typ }),
        })
        .sign(privateKey),
  };
}

type FakeKeys = Readonly<Record<FakeSigner, FakeKey>>;

function keysOf(generation: number): FakeKeys {
  return {
    RS256: keyOf('RS256', generation),
    PS256: keyOf('PS256', generation),
    ES256: keyOf('ES256', generation),
    EdDSA: keyOf('EdDSA', generation),
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const lifetimeSeconds = 3600;

type Sign = (claims: Claims, signing?: Signing) => Promise<string>;

function clientOf(request: Readonly<Request>, clients: Readonly<Record<string, FakeClient>>): string | undefined {
  const credentials = Buffer.from(String(request.headers.get('authorization')).replace(/^Basic /u, ''), 'base64');
  const [id = '', secret] = decodeURIComponent(credentials.toString('utf8')).split(':');
  return Object.hasOwn(clients, id) && clients[id]?.secret === secret ? id : undefined;
}

function tokenEndpoint(
  issuer: string,
  clients: Readonly<Record<string, FakeClient>>,
  signed: Sign,
): (request: Readonly<Request>) => Promise<Response> {
  return async (request) => {
    const form = new URLSearchParams(await request.text());
    const client = clientOf(request, clients);
    if (form.get('grant_type') !== 'client_credentials' || client === undefined) {
      return json({ error: 'invalid_client' }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const minted = await signed({
      iss: issuer,
      sub: client,
      name: client,
      aud: form.get('resource') ?? issuer,
      iat: now,
      exp: now + lifetimeSeconds,
      scope: form.get('scope') ?? '',
      client_id: client,
      ...clients[client]?.claims,
    });
    return json({ access_token: minted, token_type: 'Bearer', expires_in: lifetimeSeconds });
  };
}

const sessionLifetimeSeconds = 60;

const sessionVersion = 2;

const signedInOrganization = { id: 'acme', slg: 'acme', rol: 'admin', per: 'manage,read', fpm: '3' };

function sessionsOf(issuer: string, signed: Sign): FakeIssuer['session'] {
  let issued = 0;
  return (page, claims = {}) => {
    issued += 1;
    const now = Math.floor(Date.now() / 1000);
    return signed(
      {
        iss: issuer,
        sub: 'ada',
        name: 'Ada Lovelace',
        sid: `session-${issued}`,
        azp: page,
        iat: now,
        nbf: now,
        exp: now + sessionLifetimeSeconds,
        v: sessionVersion,
        o: signedInOrganization,
        ...claims,
      },
      { typ: 'JWT' },
    );
  };
}

function metadataOf(issuer: string, metadata: Claims): Claims {
  const { origin } = new URL(issuer);
  return {
    issuer,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    jwks_uri: `${origin}/jwks`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    response_types_supported: ['code'],
    ...metadata,
  };
}

export function fakeIssuer(issuer: string, { metadata = {}, clients = {} }: FakeIssuerOptions = {}): FakeIssuer {
  let generation = 1;
  let keys = keysOf(generation);
  let reads = 0;
  const signed: Sign = (claims, { signer = 'RS256', kid, typ = 'at+jwt' } = {}) => {
    const key = keys[signer];
    return key.sign({ ...claims }, { kid: kid === undefined ? key.kid : kid, typ });
  };
  const token = tokenEndpoint(issuer, clients, signed);
  return {
    issuer,
    answer: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/token') {
        return token(request);
      }
      reads += Number(pathname === '/jwks');
      const documents = new Map([
        ['/.well-known/oauth-authorization-server', metadataOf(issuer, metadata)],
        ['/jwks', { keys: Object.values(keys).map(({ jwk }) => jwk) }],
      ]);
      const document = documents.get(pathname);
      return Promise.resolve(document === undefined ? json({}, 404) : json(document));
    },
    sign: signed,
    session: sessionsOf(issuer, signed),
    rotate: () => {
      generation += 1;
      keys = keysOf(generation);
    },
    keySetReads: () => reads,
  };
}
