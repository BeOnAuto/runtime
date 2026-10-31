import { required } from '@on.auto/operations';
import {
  keptTokensIn,
  type ConsentServer,
  type HadSources,
  type KeptTokens,
  type OwnClient,
  type SecretReadingFailure,
  type StartAsked,
} from '@on.auto/tool-servers';
import { Effect, Function, Option } from 'effect';

import { returnAddressOf, studioBaseFor } from '../links/connect-page.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { runsUnderTheOrgsOAuthClient, type RecordedConnection } from '../registry/connection.ts';
import {
  clientChangedOf,
  isOpenConsent,
  noOpenConsent,
  stateIssueOf,
  type KeptWithConsent,
  type KeptWithLink,
} from '../registry/registry-lookup.ts';
import {
  clientSecretsHeldBy,
  clientSecretsReleasedOf,
  heldClientOf,
  signingInClientOf,
  type GivenClient,
  type KeptConnection,
} from '../registry/registry.ts';
import { unavailableWords, unrevokedWordsOf, type ConsentNamed } from './consent-words.ts';

export type ConsentAsked = Omit<StartAsked, 'state' | 'studioBase'>;

const ownClientGone = { gone: 'own_client' } as const;

export type OwnClientUnheld = SecretReadingFailure | typeof ownClientGone;

type ClientAsking = Pick<ConnectionServices, 'policy' | 'pages' | 'resolve'> & {
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

export function namedOf({ name, provider, credential, status }: RecordedConnection): ConsentNamed {
  return { name, issuer: required(credential.issuer), provider, connected: status === 'connected' };
}

function serverOf({ type, entry, provider }: RecordedConnection): ConsentServer {
  return type === 'mcp' ? { type, url: required(entry.url), givenByHand: provider === null } : { type };
}

function wayOf({ credential }: Pick<RecordedConnection, 'credential'>, scope: string | undefined): ConsentAsked['way'] {
  return {
    issuer: required(credential.issuer),
    scope,
    parameters: credential.parameters,
    authorization_endpoint: credential.authorization_endpoint,
    token_endpoint: credential.token_endpoint,
    revocation_endpoint: credential.revocation_endpoint,
    pkce: credential.pkce,
    clients: credential.clients,
    oauth_client: credential.client_source === 'own' ? credential.client_source : undefined,
  };
}

const noSources: Sources = { sourceOf: Function.constUndefined };

const theOrgsOAuthClientAlone: Sources = { sourceOf: Function.constant('own') };

export function sourcesFor(
  connection: Pick<RecordedConnection, 'credential'>,
  { consent, pages }: Pick<ConnectionServices, 'consent' | 'pages'>,
): Effect.Effect<Sources> {
  if (connection.credential.kind !== 'authorization') {
    return Effect.succeed(noSources);
  }
  return runsUnderTheOrgsOAuthClient(connection)
    ? Effect.succeed(theOrgsOAuthClientAlone)
    : consent.hadSources(studioBaseFor(pages));
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

function consentAskedOf(
  connection: RecordedConnection,
  services: Pick<ConnectionServices, 'policy' | 'pages' | 'resolve'>,
  scope: string | undefined = connection.credential.scope,
): ConsentAsked {
  return {
    server: serverOf(connection),
    way: wayOf(connection, scope),
    returnAddress: returnAddressOf(services.pages),
    reaches: reachesUnder(services.policy, services.resolve),
  };
}

export function forgottenVerifierOf({ consent }: KeptConnection, { secrets }: ConsentServices): Effect.Effect<void> {
  return consent === undefined ? Effect.void : secrets.forget(consent.verifier_secret_id);
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

type Forgetting = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages'>;

function ownClientOf(
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
): Effect.Effect<ConsentAsked, OwnClientUnheld> {
  const asked = consentAskedOf(kept.connection, services, scope);
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
): Effect.Effect<ConsentAsked, OwnClientUnheld> {
  return consentAskedUnder(heldClientOf(kept), kept, services, kept.connection.credential.scope);
}

export function consentAskedForASignIn(
  kept: KeptConnection,
  services: ClientAsking,
  scope: string | undefined,
): Effect.Effect<ConsentAsked, OwnClientUnheld> {
  return consentAskedUnder(signingInClientOf(kept), kept, services, scope);
}

function revokedWith(kept: KeptConnection, tokens: KeptTokens, services: Forgetting): Effect.Effect<void> {
  const { connection } = kept;
  const { credential } = connection;
  const client = { client_id: required(credential.client_id), client_source: required(credential.client_source) };
  return ownClientOf(heldClientOf(kept), services).pipe(
    Effect.flatMap((ownClient) =>
      services.consent
        .revoke({ ...consentAskedOf(connection, services), ownClient, client, tokens })
        .pipe(
          Effect.catch((failure) =>
            Effect.logWarning(unrevokedWordsOf(namedOf(connection), failure, client.client_source)),
          ),
        ),
    ),
    Effect.catch(({ detail }) => Effect.logWarning(unavailableWords.ownClientUnrevoked(connection.name, detail))),
  );
}

function tokensRevokedOf(kept: KeptConnection, services: Forgetting): Effect.Effect<void> {
  const { connection, secretId } = kept;
  if (connection.credential.kind !== 'authorization' || secretId === undefined) {
    return Effect.void;
  }
  return services.secrets.read(secretId).pipe(
    Effect.map((row) => Option.flatMap(Option.fromNullishOr(row), ({ value }) => keptTokensIn(value))),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (tokens) => revokedWith(kept, tokens, services),
      }),
    ),
    Effect.catch(({ detail }) => Effect.logWarning(unavailableWords.tokensUnread(connection.name, detail))),
  );
}

function secretForgottenOf(
  { secretId }: KeptConnection,
  { secrets }: Pick<Forgetting, 'secrets'>,
): Effect.Effect<void> {
  return secretId === undefined ? Effect.void : secrets.forget(secretId);
}

export function forgottenCredentialOf(kept: KeptConnection, services: Forgetting): Effect.Effect<void> {
  return Effect.andThen(tokensRevokedOf(kept, services), secretForgottenOf(kept, services));
}

function forgottenEach(secretIds: readonly string[], { secrets }: Pick<Forgetting, 'secrets'>): Effect.Effect<void> {
  return Effect.forEach(secretIds, (secretId) => secrets.forget(secretId), { discard: true });
}

export function forgottenClientsOf(kept: KeptConnection, services: Pick<Forgetting, 'secrets'>): Effect.Effect<void> {
  return forgottenEach(clientSecretsHeldBy(kept), services);
}

export function releasedClientsForgottenOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Pick<Forgetting, 'secrets'>,
): Effect.Effect<void> {
  return forgottenEach(clientSecretsReleasedOf(before, after), services);
}

function isTheSameClient(before: RecordedConnection, after: RecordedConnection): boolean {
  const [was, is] = [before.credential, after.credential];
  return was.issuer === is.issuer && was.client_id === is.client_id && was.client_source === is.client_source;
}

export function replacedCredentialOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Forgetting,
): Effect.Effect<void> {
  const tokensReplaced = isTheSameClient(before.connection, after.connection)
    ? secretForgottenOf(before, services)
    : forgottenCredentialOf(before, services);
  return Effect.andThen(tokensReplaced, releasedClientsForgottenOf(before, after, services));
}
