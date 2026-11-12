import {
  type ConsentServer,
  type HadSources,
  type OwnClient,
  type SecretReadingFailure,
  type StartAsked,
  type WayGateway,
} from '@on.auto/tool-servers';
import { Effect, Function, Option } from 'effect';

import { returnAddressOf, studioBaseFor } from '../links/connect-page.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import {
  connectsThroughItsGateway,
  runsUnderTheOrgsOAuthClient,
  type RecordedConnection,
} from '../registry/connection.ts';
import {
  clientChangedOf,
  isOpenConsent,
  noOpenConsent,
  stateIssueOf,
  type KeptWithConsent,
  type KeptWithLink,
} from '../registry/registry-lookup.ts';
import {
  clientSecretsReleasedOf,
  heldClientOf,
  signingInClientOf,
  type GivenClient,
  type KeptConnection,
} from '../registry/registry.ts';
import { gatewayOf, throughItsGateway } from './connection-gateways.ts';
import type { ConsentNamed } from './consent-words.ts';

export type ConsentAsked = Omit<StartAsked, 'state' | 'studioBase'>;

const ownClientGone = { gone: 'own_client' } as const;

const gatewayGone = { gone: 'gateway' } as const;

export type ClientUnheld = SecretReadingFailure | typeof ownClientGone | typeof gatewayGone;

type Asking = Pick<ConnectionServices, 'policy' | 'pages' | 'resolve' | 'providers'>;

type ClientAsking = Asking & {
  readonly secrets: Pick<ConnectionServices['secrets'], 'read'>;
};

export type ConsentServices = Pick<
  ConnectionServices,
  'consent' | 'policy' | 'pages' | 'secrets' | 'resolve' | 'providers'
> & {
  readonly bindsPerson: boolean;
};

export type Sources = Pick<HadSources, 'sourceOf'>;

export type FinishedConsent = Effect.Success<ReturnType<ConsentServices['consent']['finish']>>;

export function namedOf(connection: RecordedConnection): ConsentNamed {
  const { name, provider, credential, status } = connection;
  return {
    name,
    issuer: Option.getOrThrow(Option.fromNullishOr(credential.issuer)),
    provider,
    connected: status === 'connected',
    throughAGateway: connectsThroughItsGateway(connection),
  };
}

function serverOf({ type, entry, provider }: RecordedConnection): ConsentServer {
  return type === 'mcp'
    ? { type, url: Option.getOrThrow(Option.fromNullishOr(entry.url)), givenByHand: provider === null }
    : { type };
}

function wayOf(
  { credential }: Pick<RecordedConnection, 'credential'>,
  scope: string | undefined,
  gateway?: WayGateway,
): ConsentAsked['way'] {
  return {
    issuer: Option.getOrThrow(Option.fromNullishOr(credential.issuer)),
    scope,
    parameters: credential.parameters,
    authorization_endpoint: credential.authorization_endpoint,
    token_endpoint: credential.token_endpoint,
    revocation_endpoint: credential.revocation_endpoint,
    pkce: credential.pkce,
    clients: credential.clients,
    oauth_client: credential.client_source === 'own' ? credential.client_source : undefined,
    ...(gateway === undefined ? {} : { gateway }),
  };
}

const noSources: Sources = { sourceOf: Function.constUndefined };

const theOrgsOAuthClientAlone: Sources = { sourceOf: Function.constant('own') };

export function sourcesFor(
  connection: Pick<RecordedConnection, 'provider' | 'credential'>,
  { consent, pages, providers }: Pick<ConnectionServices, 'consent' | 'pages' | 'providers'>,
): Effect.Effect<Sources> {
  if (connection.credential.kind !== 'authorization') {
    return Effect.succeed(noSources);
  }
  if (runsUnderTheOrgsOAuthClient(connection)) {
    return Effect.succeed(theOrgsOAuthClientAlone);
  }
  const had = consent.hadSources(studioBaseFor(pages));
  return connectsThroughItsGateway(connection)
    ? Effect.map(had, (sources) => throughItsGateway(gatewayOf(connection, providers), sources))
    : had;
}

export function isCoveredHere(
  connection: Pick<RecordedConnection, 'credential'>,
  scope: string | undefined,
  { sourceOf }: Sources,
): boolean {
  return sourceOf(wayOf(connection, scope)) !== undefined;
}

export function sourceOfAStartOf(
  connection: Pick<RecordedConnection, 'credential'>,
  scope: string | undefined,
  { sourceOf }: Sources,
) {
  if (connection.credential.kind !== 'authorization') {
    return {};
  }
  const source = sourceOf(wayOf(connection, scope));
  return source === undefined ? {} : { client_source: source };
}

export function nextClientOf({ nextClient }: KeptConnection): { readonly next_client_id?: string } {
  return nextClient === undefined ? {} : { next_client_id: nextClient.client_id };
}

export function returnAddressFor(
  connection: Pick<RecordedConnection, 'credential'>,
  { pages }: Pick<ConnectionServices, 'pages'>,
): { readonly return_address?: string } {
  return runsUnderTheOrgsOAuthClient(connection) ? { return_address: returnAddressOf(pages) } : {};
}

export function consentAskedOf(
  connection: RecordedConnection,
  services: Asking,
  scope: string | undefined = connection.credential.scope,
): ConsentAsked {
  return {
    server: serverOf(connection),
    way: wayOf(connection, scope, gatewayOf(connection, services.providers)),
    returnAddress: returnAddressOf(services.pages),
    reaches: reachesUnder(services.policy, services.resolve),
  };
}

export function forgottenVerifierOf({ consent }: KeptConnection, { secrets }: ConsentServices): Effect.Effect<void> {
  return consent === undefined ? Effect.void : secrets.forget(consent.verifier_secret_id);
}

export function verifierOf<E>(
  { connection, consent }: KeptWithConsent,
  { secrets }: Pick<ConsentServices, 'secrets'>,
  unread: (detail: string) => E,
) {
  return secrets.read(consent.verifier_secret_id).pipe(
    Effect.mapError(({ detail }) => unread(detail)),
    Effect.flatMap((row) =>
      row === undefined ? Effect.fail(noOpenConsent(connection.name)) : Effect.succeed(row.value),
    ),
  );
}

export function openConsentOf(
  kept: KeptWithLink,
  { at, stateSha256 }: { readonly at: string; readonly stateSha256: string },
  services: ConsentServices,
) {
  if (!isOpenConsent(kept, at)) {
    return Effect.andThen(forgottenVerifierOf(kept, services), Effect.fail(noOpenConsent(kept.connection.name)));
  }
  const issue = stateIssueOf(kept, stateSha256) ?? clientChangedOf(kept, kept.consent.client_id);
  return issue === undefined ? Effect.succeed<KeptWithConsent>(kept) : Effect.fail(issue);
}

export function ownClientOf(
  given: GivenClient | undefined,
  { secrets }: Pick<ClientAsking, 'secrets'>,
): Effect.Effect<OwnClient | undefined, SecretReadingFailure> {
  if (given === undefined) {
    return Effect.undefined;
  }
  return Effect.map(secrets.read(given.secret_id), (row) =>
    row === undefined ? undefined : { clientId: given.client_id, clientSecret: row.value },
  );
}

function consentAskedUnder(
  given: GivenClient | undefined,
  kept: KeptConnection,
  services: ClientAsking,
  scope: string | undefined,
): Effect.Effect<ConsentAsked, ClientUnheld> {
  const asked = consentAskedOf(kept.connection, services, scope);
  if (connectsThroughItsGateway(kept.connection) && asked.way.gateway === undefined) {
    return Effect.fail(gatewayGone);
  }
  if (!runsUnderTheOrgsOAuthClient(kept.connection)) {
    return Effect.succeed(asked);
  }
  return Effect.flatMap(ownClientOf(given, services), (ownClient) =>
    ownClient === undefined ? Effect.fail(ownClientGone) : Effect.succeed({ ...asked, ownClient }),
  );
}

export function consentAskedUnderItsClient(
  kept: KeptConnection,
  services: ClientAsking,
): Effect.Effect<ConsentAsked, ClientUnheld> {
  return consentAskedUnder(heldClientOf(kept), kept, services, kept.connection.credential.scope);
}

export function consentAskedForASignIn(
  kept: KeptConnection,
  services: ClientAsking,
  scope: string | undefined,
): Effect.Effect<ConsentAsked, ClientUnheld> {
  return consentAskedUnder(signingInClientOf(kept), kept, services, scope);
}

export function secretForgottenOf(
  { secretId }: KeptConnection,
  { secrets }: Pick<ConnectionServices, 'secrets'>,
): Effect.Effect<void> {
  return secretId === undefined ? Effect.void : secrets.forget(secretId);
}

function forgottenEach(
  secretIds: readonly string[],
  { secrets }: Pick<ConnectionServices, 'secrets'>,
): Effect.Effect<void> {
  return Effect.forEach(secretIds, (secretId) => secrets.forget(secretId), { discard: true });
}

export function releasedClientsForgottenOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Pick<ConnectionServices, 'secrets'>,
): Effect.Effect<void> {
  return forgottenEach(clientSecretsReleasedOf(before, after), services);
}
