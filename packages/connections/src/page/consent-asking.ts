import { keptTokensIn, type ConsentServer, type StartAsked } from '@on.auto/tool-servers';
import { Effect, Function, Option } from 'effect';

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
import { unrevokedWordsOf, type ConsentNamed } from './consent-words.ts';

export type ConsentAsked = Omit<StartAsked, 'state'>;

export type ConsentServices = Pick<ConnectionServices, 'consent' | 'policy' | 'pages' | 'secrets'> & {
  readonly bindsPerson: boolean;
};

export type FinishedConsent = Effect.Success<ReturnType<ConsentServices['consent']['finish']>>;

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

export function namedOf({ name, credential }: RecordedConnection): ConsentNamed {
  return { name, issuer: required(credential.issuer) };
}

function serverOf({ type, entry }: RecordedConnection): ConsentServer {
  return type === 'mcp' ? { type, url: required(entry.url) } : { type };
}

export function consentAskedOf(
  connection: RecordedConnection,
  services: Pick<ConnectionServices, 'policy' | 'pages'>,
): ConsentAsked {
  const { credential } = connection;
  return {
    server: serverOf(connection),
    way: {
      issuer: required(credential.issuer),
      scope: credential.scope,
      parameters: credential.parameters,
      authorization_endpoint: credential.authorization_endpoint,
      token_endpoint: credential.token_endpoint,
      revocation_endpoint: credential.revocation_endpoint,
      clients: credential.clients,
    },
    returnAddress: returnAddressOf(services.pages),
    reaches: reachesUnder(services.policy),
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

export function tokensRevokedOf(
  { connection, secretId }: KeptConnection,
  services: Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages'>,
): Effect.Effect<void> {
  const { credential } = connection;
  if (credential.kind !== 'authorization' || secretId === undefined) {
    return Effect.void;
  }
  const client = { client_id: required(credential.client_id), client_source: required(credential.client_source) };
  return services.secrets.read(secretId).pipe(
    Effect.orElseSucceed(Function.constUndefined),
    Effect.map((row) => Option.flatMap(Option.fromNullishOr(row), ({ value }) => keptTokensIn(value))),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (tokens) => services.consent.revoke({ ...consentAskedOf(connection, services), client, tokens }),
      }),
    ),
    Effect.catch((failure) => Effect.logWarning(unrevokedWordsOf(namedOf(connection), failure))),
  );
}
