import {
  auth,
  ClientCredentialsProvider,
  computeScopeUnion,
  extractWWWAuthenticateParams,
  PrivateKeyJwtProvider,
  type AuthProvider,
  type FetchLike,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';
import { Option, Redacted } from 'effect';

import type { ConsentServed, TokenServing } from '../consent/consent-client.ts';
import type { MintingAuth } from '../settings/server-settings.ts';

export interface UnauthorizedContext {
  readonly response: Readonly<Response>;
  readonly serverUrl: Readonly<URL>;
  readonly fetchFn: FetchLike;
}

export interface TokenSource extends AuthProvider {
  readonly token: () => Promise<string>;
  readonly onUnauthorized: (context: UnauthorizedContext) => Promise<void>;
}

export interface ConsentTokenSources {
  readonly tokenSource: (served: ConsentServed, serving: TokenServing) => TokenSource;
}

export type Discovery = 'from_the_server' | 'from_the_issuer';

export interface TokenSourceOptions {
  readonly server: string;
  readonly serverUrl: string;
  readonly discovery: Discovery;
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly minted: (server: string, token: string) => void;
}

interface Held {
  readonly value: string;
  readonly renewAt: number;
}

interface Asking {
  readonly scope: string | undefined;
  readonly resourceMetadataUrl: Readonly<URL> | undefined;
}

const defaultLifetimeMs = 3_600_000;

const mostRenewalLeadMs = 60_000;

const millisOfASecond = 1000;

export function renewalTimeOf(heldAt: number, expiresAt: number, spreadMs = 0): number {
  const leadMs = Math.min(mostRenewalLeadMs, Math.max(0, expiresAt - heldAt) / 2);
  return expiresAt - leadMs - Math.min(spreadMs, leadMs / 2);
}

function credentialsProviderOf({ issuer, client_id, scope, credential }: MintingAuth): OAuthClientProvider {
  const common = { clientId: client_id, expectedIssuer: issuer, ...(scope === null ? {} : { scope }) };
  return credential.kind === 'client_secret'
    ? new ClientCredentialsProvider({ ...common, clientSecret: Redacted.value(credential.client_secret) })
    : new PrivateKeyJwtProvider({
        ...common,
        privateKey: Redacted.value(credential.private_key),
        algorithm: credential.algorithm,
      });
}

function providerOf(settings: MintingAuth, discovery: Discovery): OAuthClientProvider {
  const provider = credentialsProviderOf(settings);
  return discovery === 'from_the_issuer'
    ? Object.assign(provider, { discoveryState: () => ({ authorizationServerUrl: settings.issuer }) })
    : provider;
}

function askedAfter(asking: Asking, { response }: UnauthorizedContext): Asking {
  const challenge = extractWWWAuthenticateParams(response);
  return {
    scope: computeScopeUnion(asking.scope, challenge.scope),
    resourceMetadataUrl: challenge.resourceMetadataUrl ?? asking.resourceMetadataUrl,
  };
}

function authOptionsOf({ serverUrl, fetch }: TokenSourceOptions, { scope, resourceMetadataUrl }: Asking) {
  return {
    serverUrl,
    fetchFn: fetch,
    ...(scope === undefined ? {} : { scope }),
    ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
  };
}

export function tokenSource(settings: MintingAuth, options: TokenSourceOptions): TokenSource {
  const { server, discovery, now, minted } = options;
  let held: Held | undefined;
  let minting: Promise<string> | undefined;
  let asking: Asking = { scope: settings.scope ?? undefined, resourceMetadataUrl: undefined };
  const mint = async (): Promise<string> => {
    const provider = providerOf(settings, discovery);
    await auth(provider, authOptionsOf(options, asking));
    const tokens = Option.getOrThrow(Option.fromNullishOr(await provider.tokens()));
    minted(server, tokens.access_token);
    const issuedAt = now();
    const lifetimeMs = tokens.expires_in === undefined ? defaultLifetimeMs : tokens.expires_in * millisOfASecond;
    held = { value: tokens.access_token, renewAt: renewalTimeOf(issuedAt, issuedAt + lifetimeMs) };
    return tokens.access_token;
  };
  const mintOnce = (): Promise<string> => {
    minting ??= mint().finally(() => {
      minting = undefined;
    });
    return minting;
  };
  return {
    token: () => (held !== undefined && now() < held.renewAt ? Promise.resolve(held.value) : mintOnce()),
    onUnauthorized: async (context) => {
      asking = askedAfter(asking, context);
      held = undefined;
      await mintOnce();
    },
  };
}
