import { required } from '@on.auto/operations';
import { keptTokensIn, type ConsentServer, type StartAsked } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import { returnAddressOf } from '../links/connect-page.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import {
  isOpenConsent,
  noOpenConsent,
  stateIssueOf,
  type KeptWithConsent,
  type KeptWithLink,
} from '../registry/registry-lookup.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { unavailableWords, unrevokedWordsOf, type ConsentNamed } from './consent-words.ts';

export type ConsentAsked = Omit<StartAsked, 'state' | 'studioBase'>;

export type ConsentServices = Pick<ConnectionServices, 'consent' | 'policy' | 'pages' | 'secrets' | 'resolve'> & {
  readonly bindsPerson: boolean;
};

export type FinishedConsent = Effect.Success<ReturnType<ConsentServices['consent']['finish']>>;

export function namedOf({ name, provider, credential }: RecordedConnection): ConsentNamed {
  return { name, issuer: required(credential.issuer), provider };
}

function serverOf({ type, entry, provider }: RecordedConnection): ConsentServer {
  return type === 'mcp' ? { type, url: required(entry.url), givenByHand: provider === null } : { type };
}

export function wayOf({ credential }: RecordedConnection): ConsentAsked['way'] {
  return {
    issuer: required(credential.issuer),
    scope: credential.scope,
    parameters: credential.parameters,
    authorization_endpoint: credential.authorization_endpoint,
    token_endpoint: credential.token_endpoint,
    revocation_endpoint: credential.revocation_endpoint,
    clients: credential.clients,
  };
}

export function consentAskedOf(
  connection: RecordedConnection,
  services: Pick<ConnectionServices, 'policy' | 'pages' | 'resolve'>,
): ConsentAsked {
  return {
    server: serverOf(connection),
    way: wayOf(connection),
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
  const stateIssue = stateIssueOf(kept, stateSha256);
  return stateIssue === undefined ? Effect.succeed<KeptWithConsent>(kept) : Effect.fail(stateIssue);
}

type Forgetting = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages'>;

function tokensRevokedOf({ connection, secretId }: KeptConnection, services: Forgetting): Effect.Effect<void> {
  const { credential } = connection;
  if (credential.kind !== 'authorization' || secretId === undefined) {
    return Effect.void;
  }
  const client = { client_id: required(credential.client_id), client_source: required(credential.client_source) };
  const named = namedOf(connection);
  return services.secrets.read(secretId).pipe(
    Effect.map((row) => Option.flatMap(Option.fromNullishOr(row), ({ value }) => keptTokensIn(value))),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (tokens) =>
          services.consent
            .revoke({ ...consentAskedOf(connection, services), client, tokens })
            .pipe(Effect.catch((failure) => Effect.logWarning(unrevokedWordsOf(named, failure, client.client_source)))),
      }),
    ),
    Effect.catch(({ detail }) => Effect.logWarning(unavailableWords.tokensUnread(named.name, detail))),
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

function isTheSameClient(before: RecordedConnection, after: RecordedConnection): boolean {
  const [was, is] = [before.credential, after.credential];
  return was.issuer === is.issuer && was.client_id === is.client_id && was.client_source === is.client_source;
}

export function replacedCredentialOf(
  before: KeptConnection,
  after: RecordedConnection,
  services: Forgetting,
): Effect.Effect<void> {
  return isTheSameClient(before.connection, after)
    ? secretForgottenOf(before, services)
    : forgottenCredentialOf(before, services);
}
