import { keptTokensIn, type KeptTokens } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { connectsThroughItsGateway } from '../registry/connection.ts';
import { appSecretsHeldBy } from '../registry/kept-app-credentials.ts';
import { signingSecretsHeldBy } from '../registry/kept-signing.ts';
import { clientSecretsHeldBy, heldClientOf, type KeptConnection } from '../registry/registry.ts';
import { newerKeyEndedOf } from './connection-gateways.ts';
import { consentAskedOf, namedOf, ownClientOf, secretForgottenOf } from './consent-asking.ts';
import { unavailableWords, unrevokedWordsOf } from './consent-words.ts';

export type Forgetting = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages' | 'providers' | 'resolve'>;

function revokedWith(kept: KeptConnection, tokens: KeptTokens, services: Forgetting): Effect.Effect<void> {
  const { connection } = kept;
  const { credential } = connection;
  const client = {
    client_id: Option.getOrThrow(Option.fromNullishOr(credential.client_id)),
    client_source: Option.getOrThrow(Option.fromNullishOr(credential.client_source)),
  };
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
  if (
    connection.credential.kind !== 'authorization' ||
    connectsThroughItsGateway(connection) ||
    secretId === undefined
  ) {
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

function appSecretsForgottenOf(kept: KeptConnection, { secrets }: Pick<Forgetting, 'secrets'>): Effect.Effect<void> {
  return Effect.forEach(appSecretsHeldBy(kept), (secretId) => secrets.forget(secretId), { discard: true });
}

export function forgottenCredentialOf(kept: KeptConnection, services: Forgetting): Effect.Effect<void> {
  return Effect.andThen(
    tokensRevokedOf(kept, services),
    Effect.andThen(secretForgottenOf(kept, services), appSecretsForgottenOf(kept, services)),
  );
}

function forgottenClientsOf(kept: KeptConnection, { secrets }: Pick<Forgetting, 'secrets'>): Effect.Effect<void> {
  return Effect.forEach(clientSecretsHeldBy(kept), (secretId) => secrets.forget(secretId), { discard: true });
}

export const forgottenOnRemoval = Effect.fnUntraced(function* (
  found: KeptConnection,
  removed: KeptConnection,
  services: Forgetting,
) {
  const { secrets } = services;
  yield* newerKeyEndedOf(found, removed, services);
  yield* forgottenCredentialOf(removed, services);
  yield* forgottenClientsOf(removed, services);
  yield* Effect.forEach(signingSecretsHeldBy(removed.signing), (secretId) => secrets.forget(secretId), {
    discard: true,
  });
  const consents = [removed.consent, removed.nextWay?.consent].filter((consent) => consent !== undefined);
  yield* Effect.forEach(consents, ({ verifier_secret_id: verifier }) => secrets.forget(verifier), { discard: true });
});
