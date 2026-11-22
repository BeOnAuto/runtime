import { Predicate } from 'effect';
import {
  errors,
  interactionPolicy,
  type CanBePromise,
  type Configuration,
  type KoaContextWithOIDC,
} from 'oidc-provider';

import { linkingClientId, linkingClientOf } from './account-linking.ts';
import { hashedAdapterOf } from './hashed-adapter.ts';
import { authorizationServerRoutes, interactionAddressOf } from './paths.ts';
import type { ProviderRows } from './provider-rows.ts';
import { idTokenSigningAlgorithm, type SigningKey } from './signing-key.ts';

const minute = 60;

const day = 24 * 60 * minute;

const accessTokenSeconds = 15 * minute;

const refreshTokenSeconds = 30 * day;

const grantSeconds = 90 * day;

const sessionUnusedSeconds = 7 * day;

const sessionLifetimeSeconds = 30 * day;

const authorizationCodeSeconds = minute;

const interactionSeconds = 60 * minute;

const idTokenSeconds = 60 * minute;

const sessionCookie = '__Host-Http-session';

export interface PersonClaims {
  readonly name?: string;
  readonly email?: string;
}

export interface StudioClient {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
}

export interface AuthorizationServerSettings {
  readonly issuer: string;
  readonly studio: StudioClient;
  readonly resourceScopes: readonly string[];
}

export interface ConfigurationParts {
  readonly rows: ProviderRows;
  readonly signingKey: SigningKey;
  readonly claimsOf: (accountId: string) => Promise<PersonClaims | undefined>;
  readonly now: () => number;
  readonly linking: boolean;
}

export interface ServersPages {
  readonly renderError: NonNullable<Configuration['renderError']>;
  readonly logoutSource: (ctx: KoaContextWithOIDC, form: string) => CanBePromise<void>;
  readonly postLogoutSuccessSource: (ctx: KoaContextWithOIDC) => CanBePromise<void>;
}

type Grant = NonNullable<Awaited<ReturnType<NonNullable<Configuration['loadExistingGrant']>>>>;

function studioClientOf({ clientId, redirectUri, postLogoutRedirectUri }: StudioClient) {
  return {
    client_id: clientId,
    redirect_uris: [redirectUri],
    post_logout_redirect_uris: [postLogoutRedirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  } as const;
}

function isThisServer(issuer: string, resource: string): boolean {
  return resource === issuer || resource.startsWith(`${issuer}/`);
}

function secondsLeftOf(endsAt: number | undefined, longest: number, now: () => number): number {
  const nowSeconds = Math.floor(now() / 1000);
  return endsAt === undefined ? longest : Math.max(1, Math.min(longest, endsAt - nowSeconds));
}

function sessionSecondsOf(loginTs: number | undefined, now: () => number): number {
  return secondsLeftOf(loginTs === undefined ? undefined : loginTs + sessionLifetimeSeconds, sessionUnusedSeconds, now);
}

function addedToStudiosGrant({ oidc }: KoaContextWithOIDC, grant: Grant): boolean {
  const before = JSON.stringify(grant);
  grant.addOIDCScope([...oidc.requestParamOIDCScopes]);
  grant.addOIDCClaims([...oidc.requestParamClaims]);
  for (const resource of Object.keys({ ...oidc.resourceServers })) {
    grant.addResourceScope(resource, [...oidc.requestParamScopes]);
  }
  return JSON.stringify(grant) !== before;
}

function grantIdIn(ctx: KoaContextWithOIDC, clientId: string): string | undefined {
  return ctx.oidc.result?.consent?.grantId ?? ctx.oidc.session?.grantIdFor(clientId);
}

async function studiosGrant(ctx: KoaContextWithOIDC, found: Grant | undefined, accountId: string): Promise<Grant> {
  const grant = found ?? new ctx.oidc.provider.Grant({ clientId: ctx.oidc.client?.clientId, accountId });
  if (addedToStudiosGrant(ctx, grant)) {
    await grant.save();
  }
  return grant;
}

function existingGrantOf(studioClientId: string) {
  return async (ctx: KoaContextWithOIDC): Promise<Grant | undefined> => {
    const clientId = String(ctx.oidc.client?.clientId);
    const consentJustGiven = ctx.oidc.result?.consent?.grantId;
    if (clientId === linkingClientId) {
      return consentJustGiven === undefined ? undefined : ctx.oidc.provider.Grant.find(consentJustGiven);
    }
    const grantId = grantIdIn(ctx, clientId);
    const found = grantId === undefined ? undefined : await ctx.oidc.provider.Grant.find(grantId);
    const accountId = ctx.oidc.session?.accountId;
    return clientId === studioClientId && accountId !== undefined ? studiosGrant(ctx, found, accountId) : found;
  };
}

function claimsAnswered(sub: string, claims: PersonClaims, scope: string) {
  const granted = new Set(scope.split(' '));
  return {
    sub,
    ...(granted.has('profile') && claims.name !== undefined ? { name: claims.name } : {}),
    ...(granted.has('email') && claims.email !== undefined ? { email: claims.email } : {}),
  };
}

function accountsOf(claimsOf: ConfigurationParts['claimsOf']): Pick<Configuration, 'findAccount'> {
  return {
    findAccount: async (_ctx, sub) => {
      const claims = await claimsOf(sub);
      return claims === undefined
        ? undefined
        : { accountId: sub, claims: (_use, scope) => claimsAnswered(sub, claims, scope) };
    },
  };
}

const noSession = 'no_session';

const signedInAsAnAccountAnswered = new interactionPolicy.Check(
  noSession,
  'End-User authentication is required',
  'login_required',
  ({ oidc }) => oidc.account === undefined,
);

function promptsOf() {
  const policy = interactionPolicy.base();
  policy.add(new interactionPolicy.Prompt({ name: 'select_account', requestable: true }), 0);
  for (const { checks } of policy) {
    const replaced = checks.get(noSession);
    if (replaced !== undefined) {
      checks.splice(checks.indexOf(replaced), 1, signedInAsAnAccountAnswered);
    }
  }
  return policy;
}

function textOf(value: unknown): string | undefined {
  return Predicate.isString(value) && value !== '' ? value : undefined;
}

function lifetimesOf(now: () => number): Configuration['ttl'] {
  return {
    AccessToken: accessTokenSeconds,
    AuthorizationCode: authorizationCodeSeconds,
    IdToken: idTokenSeconds,
    Interaction: interactionSeconds,
    RefreshToken: refreshTokenSeconds,
    Grant: (_ctx, grant) => secondsLeftOf(grant.exp, grantSeconds, now),
    Session: (_ctx, session) => sessionSecondsOf(session.loginTs, now),
  };
}

function clientsOf({ issuer, studio }: AuthorizationServerSettings, linking: boolean): Configuration {
  return {
    clients: [studioClientOf(studio), ...(linking ? [linkingClientOf(issuer)] : [])],
    responseTypes: ['code'],
    clientAuthMethods: ['none'],
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      id_token_signed_response_alg: idTokenSigningAlgorithm,
    },
    pkce: { required: () => true },
    clientBasedCORS: () => false,
    loadExistingGrant: existingGrantOf(studio.clientId),
  };
}

function tokensOf(now: () => number): Configuration {
  return {
    ttl: lifetimesOf(now),
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    expiresWithSession: () => false,
    rotateRefreshToken: () => true,
    extraTokenClaims: (ctx) => {
      const name = textOf(ctx.oidc.client?.clientName);
      return name === undefined ? undefined : { client_name: name };
    },
  };
}

function asksForTheServer({ oidc }: KoaContextWithOIDC, resourceScopes: readonly string[]): boolean {
  const scope: unknown = Reflect.get(new Object(oidc.params), 'scope');
  return Predicate.isString(scope) && scope.split(' ').some((asked) => resourceScopes.includes(asked));
}

function resourceOf(issuer: string, resourceScopes: readonly string[]) {
  return {
    enabled: true,
    defaultResource: (ctx: KoaContextWithOIDC) => (asksForTheServer(ctx, resourceScopes) ? issuer : undefined),
    useGrantedResource: () => true,
    getResourceServerInfo: (_ctx: KoaContextWithOIDC, resource: string) => {
      if (!isThisServer(issuer, resource)) {
        throw new errors.InvalidTarget();
      }
      return {
        scope: resourceScopes.join(' '),
        audience: issuer,
        accessTokenTTL: accessTokenSeconds,
        accessTokenFormat: 'opaque',
      } as const;
    },
  };
}

function featuresOf(
  { issuer, resourceScopes }: AuthorizationServerSettings,
  { logoutSource, postLogoutSuccessSource }: ServersPages,
): Configuration['features'] {
  return {
    devInteractions: { enabled: false },
    dPoP: { enabled: false },
    pushedAuthorizationRequests: { enabled: false },
    registration: { enabled: true, issueRegistrationAccessToken: false },
    revocation: {
      enabled: true,
      allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId,
    },
    userinfo: { enabled: true },
    rpInitiatedLogout: { enabled: true, logoutSource, postLogoutSuccessSource },
    clientIdMetadataDocument: { enabled: true, ack: 'draft-02' },
    resourceIndicators: resourceOf(issuer, resourceScopes),
  };
}

export function configurationOf(
  settings: AuthorizationServerSettings,
  { rows, signingKey, claimsOf, now, linking }: ConfigurationParts,
  pages: ServersPages,
): Configuration {
  return {
    adapter: hashedAdapterOf({ rows, now }),
    jwks: { keys: [signingKey] },
    routes: authorizationServerRoutes,
    scopes: ['openid', 'offline_access', 'profile', 'email'],
    claims: { openid: ['sub'], profile: ['name'], email: ['email'] },
    cookies: {
      names: { session: sessionCookie },
      long: { httpOnly: true, sameSite: 'lax', path: '/' },
      short: { httpOnly: true, sameSite: 'lax' },
    },
    interactions: {
      policy: promptsOf(),
      url: (_ctx, interaction) => interactionAddressOf(interaction.uid),
    },
    ...clientsOf(settings, linking),
    ...tokensOf(now),
    ...accountsOf(claimsOf),
    renderError: pages.renderError,
    features: featuresOf(settings, pages),
  };
}
