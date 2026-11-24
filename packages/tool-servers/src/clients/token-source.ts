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
import type { SubjectTokensOfACall } from '@on.auto/operations';
import { Option, Redacted } from 'effect';

import type { AssertedTokens } from '../assertions/requested-tokens.ts';
import { assertedTokensOf, type Assertion } from '../assertions/signed-assertions.ts';
import type { ConsentServed, TokenServing } from '../consent/consent-client.ts';
import { isResourceOf } from '../consent/server-metadata.ts';
import { exchangedTokensOf } from '../exchange/exchanged-tokens.ts';
import type { ClientMintingAuth, MintingAuth, MintingCredential } from '../settings/server-settings.ts';

export interface UnauthorizedContext {
  readonly response: Readonly<Response>;
  readonly serverUrl: Readonly<URL>;
  readonly fetchFn: FetchLike;
}

export interface TokenSource extends AuthProvider {
  readonly token: () => Promise<string>;
  readonly onUnauthorized: (context: UnauthorizedContext) => Promise<void>;
  readonly recordedResources?: () => readonly string[];
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
  readonly subjectTokens?: SubjectTokensOfACall | undefined;
  readonly org?: string | undefined;
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

type CredentialsProvider = ClientCredentialsProvider | PrivateKeyJwtProvider;

function credentialsProviderOf({ issuer, client_id, scope, credential }: ClientMintingAuth): CredentialsProvider {
  const common = { clientId: client_id, expectedIssuer: issuer, ...(scope === null ? {} : { scope }) };
  return credential.kind === 'client_secret'
    ? new ClientCredentialsProvider({ ...common, clientSecret: Redacted.value(credential.client_secret) })
    : new PrivateKeyJwtProvider({
        ...common,
        privateKey: Redacted.value(credential.private_key),
        algorithm: credential.algorithm,
      });
}

function discoveryOf(settings: ClientMintingAuth, discovery: Discovery) {
  return discovery === 'from_the_issuer' ? { discoveryState: () => ({ authorizationServerUrl: settings.issuer }) } : {};
}

function resourceCheckedAndLeftOut(serverUrl: Readonly<URL> | string, resource?: string): Promise<undefined> {
  const server = new URL(serverUrl).href;
  return Promise.try((): undefined => {
    if (resource !== undefined && !isResourceOf(server, resource)) {
      throw new Error(
        `The tool server at ${server} names ${resource} as the resource it protects, which is not its own address, so no token is asked for it`,
      );
    }
  });
}

type Prepared = CredentialsProvider['prepareTokenRequest'];

function withTheParameters(prepared: Prepared, parameters: Readonly<Record<string, string>>): Prepared {
  return (scope?: string) => {
    const request = prepared(scope);
    for (const [name, value] of Object.entries(parameters)) {
      request.set(name, value);
    }
    return request;
  };
}

function preparedOf(prepared: Prepared, { parameters, audience }: ClientMintingAuth) {
  return parameters === undefined && audience === undefined
    ? {}
    : {
        prepareTokenRequest: withTheParameters(prepared, {
          ...parameters,
          ...(audience === undefined ? {} : { audience }),
        }),
      };
}

function audienceOf(audience?: string) {
  return audience === undefined ? {} : { validateResourceURL: resourceCheckedAndLeftOut };
}

function providerOf(settings: ClientMintingAuth, discovery: Discovery): OAuthClientProvider {
  const provider = credentialsProviderOf(settings);
  const preparedByTheCredentials = provider.prepareTokenRequest.bind(provider);
  return Object.assign(
    provider,
    discoveryOf(settings, discovery),
    audienceOf(settings.audience),
    preparedOf(preparedByTheCredentials, settings),
  );
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

async function credentialsTokensOf(
  settings: ClientMintingAuth,
  options: TokenSourceOptions,
  asking: Asking,
): Promise<AssertedTokens> {
  const provider = providerOf(settings, options.discovery);
  await auth(provider, authOptionsOf(options, asking));
  return Option.getOrThrow(Option.fromNullishOr(await provider.tokens()));
}

type PrivateKey = Extract<MintingCredential, { readonly kind: 'private_key' }>;

function isPrivateKey(credential: MintingCredential): credential is PrivateKey {
  return credential.kind === 'private_key';
}

function assertionOf(settings: ClientMintingAuth, { scope }: Asking): Assertion {
  const { private_key: privateKey, algorithm } = Option.getOrThrow(
    Option.liftPredicate(settings.credential, isPrivateKey),
  );
  return {
    issuer: settings.issuer,
    clientId: settings.client_id,
    subject: settings.subject,
    scope,
    privateKey,
    algorithm,
    tokenRequest: settings.token_request,
  };
}

function tokensOf(settings: MintingAuth, options: TokenSourceOptions, asking: Asking): Promise<AssertedTokens> {
  if (settings.grant === 'token_exchange') {
    return exchangedTokensOf(settings, asking.scope, options);
  }
  return settings.grant === 'jwt_bearer'
    ? assertedTokensOf(assertionOf(settings, asking), { fetch: options.fetch, now: options.now })
    : credentialsTokensOf(settings, options, asking);
}

export function tokenSource(settings: MintingAuth, options: TokenSourceOptions): TokenSource {
  const { server, now, minted } = options;
  let held: Held | undefined;
  let minting: Promise<string> | undefined;
  let asking: Asking = { scope: settings.scope ?? undefined, resourceMetadataUrl: undefined };
  const mint = async (): Promise<string> => {
    const tokens = await tokensOf(settings, options, asking);
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
