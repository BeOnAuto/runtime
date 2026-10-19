import type { FetchLike } from '@modelcontextprotocol/client';
import type { Reaches } from '@on.auto/outbound';
import { Effect, type Redacted } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import type { Timer } from '../clients/http-client.ts';
import type { ConsentTokenSources, TokenSource } from '../clients/token-source.ts';
import { heldAmongSecrets, keptTokensOf, type TokenHolding } from '../consent-tokens/kept-tokens.ts';
import type { ConnectionUnready } from '../org-servers/connection-source.ts';
import { sourcesHad, type ClientSource, type ClientsHad, type WayOfClients } from './client-sources.ts';
import type { ConsentRequests } from './consent-requests.ts';

export interface ConsentWay extends WayOfClients {
  readonly scope?: string | undefined;
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly authorization_endpoint?: string | undefined;
  readonly token_endpoint?: string | undefined;
  readonly revocation_endpoint?: string | undefined;
}

export type ConsentServer = { readonly type: 'mcp'; readonly url: string } | { readonly type: 'openapi' };

export interface ConsentAsked {
  readonly server: ConsentServer;
  readonly way: ConsentWay;
  readonly returnAddress: string;
  readonly reaches: Reaches;
}

export interface StartAsked extends ConsentAsked {
  readonly state: string;
}

export interface ChosenClient {
  readonly client_id: string;
  readonly client_source: ClientSource;
}

export interface StartedConsent {
  readonly url: string;
  readonly verifier: Redacted.Redacted;
  readonly client: ChosenClient;
}

export interface FinishAsked extends ConsentAsked {
  readonly client: ChosenClient;
  readonly code: string;
  readonly iss: string | undefined;
  readonly verifier: Redacted.Redacted;
}

export interface FinishedConsent {
  readonly tokens: Redacted.Redacted;
  readonly scope: string | undefined;
  readonly revoked: Effect.Effect<void>;
}

export type ConsentRefusal =
  | { readonly refused: 'another_issuer'; readonly named: string; readonly by: 'server' | 'authorization_server' }
  | { readonly refused: 'another_resource'; readonly named: string }
  | { readonly refused: 'no_metadata' }
  | { readonly refused: 'no_challenge' }
  | { readonly refused: 'no_client' }
  | { readonly refused: 'client_gone' }
  | { readonly refused: 'host'; readonly rule: string }
  | { readonly refused: 'unanswered' }
  | { readonly refused: 'iss' }
  | { readonly refused: 'code' }
  | { readonly refused: 'no_scope' }
  | { readonly refused: 'malformed_scope' };

export interface HeldTokens {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export type TokensReplaced = { readonly replaced: true; readonly version: number } | { readonly replaced: false };

export type TokensClaimed = { readonly claimed: true; readonly until: string } | { readonly claimed: false };

export type TokensEnded = 'consent_ended' | 'client_gone';

export interface ConnectionTokens {
  readonly read: Effect.Effect<HeldTokens, ConnectionUnready>;
  readonly replace: (
    version: number,
    value: Redacted.Redacted,
  ) => Effect.Effect<TokensReplaced, { readonly detail: string }>;
  readonly claim: (version: number, lastingMs: number) => Effect.Effect<TokensClaimed>;
  readonly broken: (ended: TokensEnded) => Effect.Effect<never, ConnectionUnready>;
}

export interface ConsentServed extends ConsentAsked {
  readonly client: ChosenClient;
  readonly held: HeldTokens;
  readonly tokens: ConnectionTokens;
}

export interface TokenServing extends TokenHolding {
  readonly name: string;
  readonly now: () => number;
  readonly timer: Timer;
}

export interface RevokeAsked extends ConsentAsked {
  readonly client: ChosenClient;
  readonly tokens: Redacted.Redacted;
}

export type RevocationFailure = ConsentRefusal | { readonly refused: 'not_revoked'; readonly detail: string };

export interface KeptRegistration {
  readonly clientId: string;
  readonly registration: Redacted.Redacted;
}

export interface ClientRegistrations {
  readonly latestAt: (issuer: string) => Effect.Effect<KeptRegistration | undefined>;
  readonly named: (issuer: string, clientId: string) => Effect.Effect<KeptRegistration | undefined>;
  readonly keep: (issuer: string, kept: KeptRegistration) => Effect.Effect<void>;
}

export interface ConsentClientOptions extends ClientsHad {
  readonly fetch: FetchLike;
  readonly registrations: ClientRegistrations;
  readonly requestMs?: number;
  readonly requestTimeout?: (ms: number) => AbortSignal;
  readonly renewalSpreadMs?: number;
}

export interface ConsentClient extends ConsentTokenSources {
  readonly sourcesOf: (way: WayOfClients) => readonly ClientSource[];
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
  readonly revoke: (asked: RevokeAsked) => Effect.Effect<void, RevocationFailure>;
}

const mostRenewalSpreadMs = 5000;

async function requestsOf(options: ConsentClientOptions, renewalSpreadMs: number): Promise<ConsentRequests> {
  const { consentRequests } = await import('./consent-requests.ts');
  return consentRequests({
    ...options,
    requestMs: options.requestMs ?? toolBounds.callMs,
    requestTimeout: options.requestTimeout ?? ((ms) => AbortSignal.timeout(ms)),
    renewalSpreadMs,
  });
}

function servedTokens(
  loaded: Effect.Effect<ConsentRequests>,
  served: ConsentServed,
  serving: TokenServing,
): TokenSource {
  const kept = keptTokensOf(served.held.value);
  const heldAt = serving.now();
  heldAmongSecrets(kept, serving);
  const sourcing: { source?: Promise<TokenSource> } = {};
  const sourceOnUse = (): Promise<TokenSource> => {
    sourcing.source ??= Effect.runPromise(
      Effect.map(loaded, (requests) => requests.tokenSource({ served, kept, heldAt, serving })),
    );
    return sourcing.source;
  };
  return {
    token: async () => (await sourceOnUse()).token(),
    onUnauthorized: async (context) => {
      await (await sourceOnUse()).onUnauthorized(context);
    },
  };
}

export function makeConsentClient(options: ConsentClientOptions): ConsentClient {
  const renewalSpreadMs = options.renewalSpreadMs ?? Math.floor(Math.random() * mostRenewalSpreadMs);
  const loading: { requests?: Promise<ConsentRequests> } = {};
  const loaded = Effect.promise(() => {
    loading.requests ??= requestsOf(options, renewalSpreadMs);
    return loading.requests;
  });
  return {
    sourcesOf: (way) => sourcesHad(way, options),
    start: (asked) => Effect.flatMap(loaded, (requests) => requests.start(asked)),
    finish: (asked) => Effect.flatMap(loaded, (requests) => requests.finish(asked)),
    tokenSource: (served, serving) => servedTokens(loaded, served, serving),
    revoke: (asked) => Effect.flatMap(loaded, (requests) => requests.revoke(asked)),
  };
}
