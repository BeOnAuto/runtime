import type { FetchLike } from '@modelcontextprotocol/client';
import type { Reaches } from '@on.auto/outbound';
import { Effect, type Redacted } from 'effect';

import type { Timer } from '../clients/http-client.ts';
import type { ConsentTokenSources, TokenSource } from '../clients/token-source.ts';
import {
  serviceClientsListed,
  throughAutoOf,
  usableClientsOf,
  type AutoClients,
  type ThroughAuto,
} from '../consent-through-auto/auto-clients.ts';
import type { ConsentRequests } from '../consent-through-auto/consents-by-source.ts';
import { heldAmongSecrets, type KeptTokens, type TokenHolding } from '../consent-tokens/kept-tokens.ts';
import type { ConnectionUnready } from '../org-servers/connection-source.ts';
import {
  sourcesHad,
  sourceTakenOf,
  type ClientSource,
  type ClientsHad,
  type HadSources,
  type ServiceClient,
  type WayOfClients,
} from './client-sources.ts';

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
  readonly studioBase: string;
}

export interface ChosenClient {
  readonly client_id: string;
  readonly client_source: ClientSource;
}

export interface StartedConsent {
  readonly url: string;
  readonly state: string;
  readonly verifier: Redacted.Redacted;
  readonly client: ChosenClient;
}

interface FinishAskedOfTheStart extends ConsentAsked {
  readonly client: ChosenClient;
  readonly verifier: Redacted.Redacted;
}

export interface CodeFinishAsked extends FinishAskedOfTheStart {
  readonly code: string;
  readonly iss: string | undefined;
}

export interface HandleFinishAsked extends FinishAskedOfTheStart {
  readonly handle: string;
}

export type FinishAsked = CodeFinishAsked | HandleFinishAsked;

export interface FinishedConsent {
  readonly client: ChosenClient;
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
  | { readonly refused: 'studio_elsewhere' }
  | { readonly refused: 'start_refused' }
  | { readonly refused: 'no_scope' }
  | { readonly refused: 'malformed_scope' }
  | { readonly refused: 'registration_unavailable'; readonly detail: string }
  | { readonly refused: 'registration_refused'; readonly detail: string };

export interface KeptRow {
  readonly value: Redacted.Redacted;
  readonly version: number;
  readonly claimedUntil: string | undefined;
}

export interface HeldTokens extends Omit<KeptRow, 'value'> {
  readonly tokens: KeptTokens;
}

export type TokensReplaced = { readonly replaced: true; readonly version: number } | { readonly replaced: false };

export type TokensClaimed = { readonly claimed: true; readonly until: string } | { readonly claimed: false };

export type TokensEnded = 'consent_ended' | 'client_gone' | 'key_unknown';

export interface SecretKeepingFailure {
  readonly _tag: 'secret_refused' | 'custodian_refused' | 'keeper_unavailable';
  readonly detail: string;
}

export interface SecretReadingFailure {
  readonly _tag: 'secret_key_unknown' | 'custodian_refused' | 'keeper_unavailable';
  readonly kid?: string | undefined;
  readonly detail: string;
}

export interface RegistrationUnavailable {
  readonly _tag: SecretKeepingFailure['_tag'] | SecretReadingFailure['_tag'];
  readonly detail: string;
}

export interface ConnectionTokens {
  readonly read: Effect.Effect<HeldTokens, ConnectionUnready>;
  readonly replace: (version: number, value: Redacted.Redacted) => Effect.Effect<TokensReplaced, SecretKeepingFailure>;
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
  readonly tokens: KeptTokens;
}

export type RevocationFailure =
  | ConsentRefusal
  | { readonly refused: 'not_revoked'; readonly status: number }
  | { readonly refused: 'unknown_key' };

export interface KeptRegistration {
  readonly clientId: string;
  readonly registration: Redacted.Redacted;
}

export interface ClientRegistrations {
  readonly latestAt: (issuer: string) => Effect.Effect<KeptRegistration | undefined, RegistrationUnavailable>;
  readonly named: (
    issuer: string,
    clientId: string,
  ) => Effect.Effect<KeptRegistration | undefined, RegistrationUnavailable>;
  readonly keep: (issuer: string, kept: KeptRegistration) => Effect.Effect<void, RegistrationUnavailable>;
}

export interface ConsentClientOptions extends Omit<ClientsHad, 'serviceClients'> {
  readonly fetch: FetchLike;
  readonly registrations: ClientRegistrations;
  readonly autoClients?: AutoClients;
  readonly requestMs?: number;
  readonly requestTimeout?: (ms: number) => AbortSignal;
  readonly renewalSpreadMs?: number;
}

export interface ConsentClient extends ConsentTokenSources {
  readonly hadSources: (studioBase: string) => Effect.Effect<HadSources>;
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
  readonly revoke: (asked: RevokeAsked) => Effect.Effect<void, RevocationFailure>;
}

export interface LoadedOptions extends ConsentClientOptions {
  readonly auto: ThroughAuto;
  readonly serviceClients: Effect.Effect<readonly ServiceClient[]>;
  readonly renewalSpreadMs: number;
}

const mostRenewalSpreadMs = 5000;

async function requestsOf(options: LoadedOptions): Promise<ConsentRequests> {
  const { consentRequests } = await import('../consent-through-auto/consents-by-source.ts');
  return consentRequests(options);
}

function loadedOf(options: ConsentClientOptions): LoadedOptions {
  const auto = throughAutoOf(options);
  const renewalSpreadMs = options.renewalSpreadMs ?? Math.floor(Math.random() * mostRenewalSpreadMs);
  return { ...options, auto, serviceClients: serviceClientsListed(auto), renewalSpreadMs };
}

function hadSourcesOf(options: LoadedOptions, studioBase: string): Effect.Effect<HadSources> {
  const usable = usableClientsOf(options.auto, studioBase, options.serviceClients);
  return Effect.map(usable, (serviceClients) => ({
    sourcesOf: (way: WayOfClients): readonly ClientSource[] => sourcesHad(way, { ...options, serviceClients }),
    sourceOf: (way: WayOfClients) => sourceTakenOf(way, { ...options, serviceClients }),
  }));
}

function servedTokens(
  loaded: Effect.Effect<ConsentRequests>,
  served: ConsentServed,
  serving: TokenServing,
): TokenSource {
  const heldAt = serving.now();
  heldAmongSecrets(served.held.tokens, serving);
  const sourcing: { source?: Promise<TokenSource> } = {};
  const sourceOnUse = (): Promise<TokenSource> => {
    sourcing.source ??= Effect.runPromise(
      Effect.map(loaded, (requests) => requests.tokenSource({ served, heldAt, serving })),
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

export function makeConsentClient(given: ConsentClientOptions): ConsentClient {
  const options = loadedOf(given);
  const loading: { requests?: Promise<ConsentRequests> } = {};
  const loaded = Effect.promise(() => {
    loading.requests ??= requestsOf(options);
    return loading.requests;
  });
  return {
    hadSources: (studioBase) => hadSourcesOf(options, studioBase),
    start: (asked) => Effect.flatMap(loaded, (requests) => requests.start(asked)),
    finish: (asked) => Effect.flatMap(loaded, (requests) => requests.finish(asked)),
    tokenSource: (served, serving) => servedTokens(loaded, served, serving),
    revoke: (asked) => Effect.flatMap(loaded, (requests) => requests.revoke(asked)),
  };
}
