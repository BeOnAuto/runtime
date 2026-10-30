import type { FetchLike } from '@modelcontextprotocol/client';
import type { Reaches } from '@on.auto/outbound';
import type { Effect, Redacted } from 'effect';

import type { Timer } from '../clients/http-client.ts';
import type { ConsentTokenSources } from '../clients/token-source.ts';
import type { AutoClients, ThroughAuto } from '../consent-through-auto/auto-clients.ts';
import type { KeptTokens, TokenHolding } from '../consent-tokens/kept-tokens.ts';
import type { ConnectionUnready } from '../org-servers/connection-source.ts';
import type {
  ClientSource,
  ClientsHad,
  HadSources,
  OwnClient,
  ServiceClient,
  WayClientSource,
  WayOfClients,
} from './client-sources.ts';
import type { RegistrationKeeping } from './dynamic-registration.ts';

export interface ConsentWay extends WayOfClients {
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly authorization_endpoint?: string | undefined;
  readonly token_endpoint?: string | undefined;
  readonly revocation_endpoint?: string | undefined;
}

export type ConsentServer =
  | { readonly type: 'mcp'; readonly url: string; readonly givenByHand?: boolean }
  | { readonly type: 'openapi' };

export interface ConsentAsked {
  readonly server: ConsentServer;
  readonly way: ConsentWay;
  readonly returnAddress: string;
  readonly reaches: Reaches;
  readonly ownClient?: OwnClient | undefined;
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

export type ConsentStep = 'ping' | 'resource_metadata' | 'authorization_server_metadata' | 'registration' | 'token';

export type ConsentCallAnswer =
  | { readonly status: number; readonly retryAfterMs: number | null; readonly errorCode?: string }
  | { readonly failed: 'timed_out' | 'unreachable' | 'unreadable' | 'failing' };

export interface ConsentCall {
  readonly step: ConsentStep;
  readonly host: string;
  readonly answer: ConsentCallAnswer;
}

export interface UnansweredCall {
  readonly refused: 'unanswered';
  readonly call: ConsentCall;
}

export type ConsentRefusal =
  | { readonly refused: 'another_issuer'; readonly named: string; readonly by: 'server' | 'authorization_server' }
  | { readonly refused: 'another_resource'; readonly named: string }
  | { readonly refused: 'no_metadata' }
  | { readonly refused: 'no_challenge' }
  | { readonly refused: 'unpinned_endpoint'; readonly endpoint: string }
  | { readonly refused: 'authorization_server_unnamed'; readonly url: string }
  | { readonly refused: 'no_client' }
  | { readonly refused: 'client_gone' }
  | { readonly refused: 'host'; readonly rule: string }
  | { readonly refused: 'unanswered'; readonly call?: ConsentCall }
  | { readonly refused: 'iss' }
  | { readonly refused: 'code' }
  | { readonly refused: 'studio_elsewhere' }
  | { readonly refused: 'start_refused' }
  | { readonly refused: 'no_scope' }
  | { readonly refused: 'malformed_scope' }
  | { readonly refused: 'registration_unavailable'; readonly detail: string }
  | { readonly refused: 'registration_refused'; readonly detail: string };

export type Refused<Refusal extends ConsentRefusal['refused']> = Extract<ConsentRefusal, { readonly refused: Refusal }>;

export interface WayAsked {
  readonly url: string;
  readonly reaches: Reaches;
}

export interface NamedWay {
  readonly issuer: string;
  readonly clients: readonly WayClientSource[];
  readonly scope: string | undefined;
}

export type IssuerRefusal = Refused<
  'another_issuer' | 'no_metadata' | 'no_challenge' | 'unpinned_endpoint' | 'no_client' | 'unanswered'
>;

export type WayRefusal =
  | { readonly refused: 'no_authorization_server' }
  | Refused<'another_resource' | 'malformed_scope' | 'host'>
  | UnansweredCall
  | { readonly refused: 'at_the_issuer'; readonly issuer: string; readonly refusal: IssuerRefusal };

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
  readonly fetch?: FetchLike;
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

export interface RegistrationPlace {
  readonly issuer: string;
  readonly server: string | null;
}

export interface ClientRegistrations {
  readonly latestAt: (place: RegistrationPlace) => Effect.Effect<KeptRegistration | undefined, RegistrationUnavailable>;
  readonly named: (
    issuer: string,
    clientId: string,
  ) => Effect.Effect<KeptRegistration | undefined, RegistrationUnavailable>;
  readonly keep: (place: RegistrationPlace, kept: KeptRegistration) => Effect.Effect<void, RegistrationUnavailable>;
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
  readonly namedWay: (asked: WayAsked) => Effect.Effect<NamedWay, WayRefusal>;
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
  readonly revoke: (asked: RevokeAsked) => Effect.Effect<void, RevocationFailure>;
}

export interface LoadedOptions extends ConsentClientOptions, Omit<RegistrationKeeping, 'registrations'> {
  readonly auto: ThroughAuto;
  readonly serviceClients: Effect.Effect<readonly ServiceClient[]>;
  readonly renewalSpreadMs: number;
}
