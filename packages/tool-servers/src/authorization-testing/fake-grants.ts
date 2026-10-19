import { createHash } from 'node:crypto';

import { json } from './authorization-answers.ts';
import { isPublic, type ClientRegistration, type FakeClients, type KnownClient } from './fake-clients.ts';

interface Minting {
  readonly requested: number;
  readonly clientId: string;
  readonly grant: string | undefined;
}

export interface FakeTokens {
  readonly minted: (minting: Minting) => Readonly<Record<string, unknown>>;
  readonly accepts: (token: string) => boolean;
  readonly revokeEveryToken: () => void;
  readonly revokeGrant: (grant: string) => void;
  readonly revokeToken: (token: string, clientId: string) => void;
}

export interface TokenRequest {
  readonly form: Readonly<URLSearchParams>;
  readonly client: KnownClient;
  readonly requested: number;
}

export interface FakeGrants {
  readonly authorize: (request: Readonly<Request>) => Promise<Response>;
  readonly clientCredentials: (asked: TokenRequest) => Response;
  readonly exchange: (asked: TokenRequest) => Response;
  readonly refresh: (asked: TokenRequest) => Response;
  readonly revoke: (asked: TokenRequest) => Response;
}

interface Code {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly scope: string | undefined;
}

interface Refresh {
  readonly grant: string;
  readonly clientId: string;
  readonly scope: string | undefined;
}

interface Live {
  readonly expiresAt: number;
  readonly clientId: string;
  readonly grant: string | undefined;
}

interface Granting {
  readonly grant: string;
  readonly refreshToken: string | undefined;
  readonly scope: string | undefined;
}

interface GrantStore {
  readonly issuer: string;
  readonly rotates: boolean;
  readonly refreshes: boolean;
  readonly grantedScope: string | undefined;
  readonly tokens: FakeTokens;
  readonly codes: Map<string, Code>;
  readonly refreshTokens: Map<string, Refresh>;
  readonly retired: Map<string, string>;
}

interface Authorizing {
  readonly asked: Readonly<URLSearchParams>;
  readonly redirectUri: string;
  readonly state: string | undefined;
}

const lifetimeWhenUnsaid = 3600;

function invalidGrant(): Response {
  return json({ error: 'invalid_grant' }, 400);
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function redirectedTo(redirectUri: string, parameters: Readonly<Record<string, string | undefined>>): Response {
  const location = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      location.searchParams.set(name, value);
    }
  }
  return new Response(null, { status: 302, headers: { location: location.href } });
}

export function fakeTokens({ expiresInSeconds }: ClientRegistration): FakeTokens {
  const live = new Map<string, Live>();
  const revokedWhere = (isRevoked: (held: Live) => boolean): void => {
    for (const [token, held] of live) {
      if (isRevoked(held)) {
        live.delete(token);
      }
    }
  };
  return {
    minted: ({ requested, clientId, grant }) => {
      const token = `token-${String(requested)}-${crypto.randomUUID()}`;
      live.set(token, { expiresAt: Date.now() + (expiresInSeconds ?? lifetimeWhenUnsaid) * 1000, clientId, grant });
      return {
        access_token: token,
        token_type: 'Bearer',
        ...(expiresInSeconds === null ? {} : { expires_in: expiresInSeconds }),
      };
    },
    accepts: (presented) => (live.get(presented)?.expiresAt ?? 0) > Date.now(),
    revokeEveryToken: () => {
      live.clear();
    },
    revokeGrant: (grant) => {
      revokedWhere((held) => held.grant === grant);
    },
    revokeToken: (token, clientId) => {
      if (live.get(token)?.clientId === clientId) {
        live.delete(token);
      }
    },
  };
}

function endGrant(store: GrantStore, grant: string): void {
  store.tokens.revokeGrant(grant);
  for (const [token, held] of store.refreshTokens) {
    if (held.grant === grant) {
      store.refreshTokens.delete(token);
    }
  }
}

function refreshTokenOf(store: GrantStore, held: Refresh): string {
  const token = `refresh-${crypto.randomUUID()}`;
  store.refreshTokens.set(token, held);
  return token;
}

function granted(store: GrantStore, { client, requested }: TokenRequest, granting: Granting): Response {
  const { grant, refreshToken, scope } = granting;
  return json({
    ...store.tokens.minted({ requested, clientId: client.clientId, grant }),
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(scope === undefined ? {} : { scope }),
  });
}

function codeOf(store: GrantStore, { client, redirectUri, asked }: Authorizing & { readonly client: KnownClient }) {
  const code = `code-${crypto.randomUUID()}`;
  store.codes.set(code, {
    clientId: client.clientId,
    redirectUri,
    challenge: String(asked.get('code_challenge')),
    scope: store.grantedScope ?? asked.get('scope') ?? undefined,
  });
  return code;
}

function refusedRequestOf({ asked, redirectUri, state }: Authorizing, issuer: string): Response | undefined {
  if (asked.get('response_type') !== 'code') {
    return redirectedTo(redirectUri, { error: 'unsupported_response_type', state, iss: issuer });
  }
  return asked.get('code_challenge') === null || asked.get('code_challenge_method') !== 'S256'
    ? redirectedTo(redirectUri, { error: 'invalid_request', state, iss: issuer })
    : undefined;
}

async function authorized(store: GrantStore, clients: FakeClients, request: Readonly<Request>): Promise<Response> {
  const asked = new URL(request.url).searchParams;
  const client = await clients.known(asked.get('client_id') ?? '');
  const authorizing = { asked, redirectUri: asked.get('redirect_uri') ?? '', state: asked.get('state') ?? undefined };
  if (client === undefined || !client.redirectUris.includes(authorizing.redirectUri)) {
    return json({ error: 'invalid_request', error_description: 'The client or its redirect URI is unknown here' }, 400);
  }
  return (
    refusedRequestOf(authorizing, store.issuer) ??
    redirectedTo(authorizing.redirectUri, {
      code: codeOf(store, { ...authorizing, client }),
      state: authorizing.state,
      iss: store.issuer,
    })
  );
}

function isRedeemedBy(code: Code | undefined, { form, client }: TokenRequest): code is Code {
  return (
    code !== undefined &&
    code.clientId === client.clientId &&
    code.redirectUri === form.get('redirect_uri') &&
    code.challenge === challengeOf(form.get('code_verifier') ?? '')
  );
}

function exchanged(store: GrantStore, asked: TokenRequest): Response {
  const presented = asked.form.get('code') ?? '';
  const code = store.codes.get(presented);
  store.codes.delete(presented);
  if (!isRedeemedBy(code, asked)) {
    return invalidGrant();
  }
  const grant = crypto.randomUUID();
  const refreshToken = store.refreshes
    ? refreshTokenOf(store, { grant, clientId: asked.client.clientId, scope: code.scope })
    : undefined;
  return granted(store, asked, { grant, refreshToken, scope: code.scope });
}

function refreshed(store: GrantStore, asked: TokenRequest): Response {
  const presented = asked.form.get('refresh_token') ?? '';
  const reused = store.retired.get(presented);
  if (reused !== undefined) {
    endGrant(store, reused);
  }
  const held = store.refreshTokens.get(presented);
  if (held === undefined || held.clientId !== asked.client.clientId) {
    return invalidGrant();
  }
  if (!store.rotates) {
    return granted(store, asked, { grant: held.grant, refreshToken: undefined, scope: held.scope });
  }
  store.refreshTokens.delete(presented);
  store.retired.set(presented, held.grant);
  return granted(store, asked, { grant: held.grant, refreshToken: refreshTokenOf(store, held), scope: held.scope });
}

function clientCredentialsGranted(store: GrantStore, { client, requested }: TokenRequest): Response {
  return isPublic(client)
    ? json({ error: 'unauthorized_client' }, 400)
    : json(store.tokens.minted({ requested, clientId: client.clientId, grant: undefined }));
}

function revoked(store: GrantStore, { form, client }: TokenRequest): Response {
  const token = form.get('token') ?? '';
  const held = store.refreshTokens.get(token);
  if (held === undefined) {
    store.tokens.revokeToken(token, client.clientId);
  } else if (held.clientId === client.clientId) {
    endGrant(store, held.grant);
  }
  return new Response(null, { status: 200 });
}

export function fakeGrants(
  issuer: string,
  registration: ClientRegistration,
  clients: FakeClients,
  tokens: FakeTokens,
): FakeGrants {
  const store: GrantStore = {
    issuer,
    rotates: registration.rotatesRefreshTokens === true,
    refreshes: registration.issuesRefreshTokens !== false,
    grantedScope: registration.grantedScope,
    tokens,
    codes: new Map(),
    refreshTokens: new Map(),
    retired: new Map(),
  };
  return {
    authorize: (request) => authorized(store, clients, request),
    clientCredentials: (asked) => clientCredentialsGranted(store, asked),
    exchange: (asked) => exchanged(store, asked),
    refresh: (asked) => refreshed(store, asked),
    revoke: (asked) => revoked(store, asked),
  };
}
