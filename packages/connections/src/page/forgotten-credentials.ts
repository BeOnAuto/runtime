import { keptTokensIn, type KeptTokens } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { connectsThroughItsGateway, type RecordedConnection } from '../registry/connection.ts';
import { clientSecretsHeldBy, heldClientOf, type KeptConnection } from '../registry/registry.ts';
import { replacedKeyEndedOf } from './connection-gateways.ts';
import {
  consentAskedOf,
  namedOf,
  ownClientOf,
  releasedClientsForgottenOf,
  secretForgottenOf,
} from './consent-asking.ts';
import { unavailableWords, unrevokedWordsOf } from './consent-words.ts';

type Forgetting = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'pages' | 'providers' | 'resolve'>;

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

export function forgottenCredentialOf(kept: KeptConnection, services: Forgetting): Effect.Effect<void> {
  return Effect.andThen(tokensRevokedOf(kept, services), secretForgottenOf(kept, services));
}

export function forgottenClientsOf(
  kept: KeptConnection,
  { secrets }: Pick<Forgetting, 'secrets'>,
): Effect.Effect<void> {
  return Effect.forEach(clientSecretsHeldBy(kept), (secretId) => secrets.forget(secretId), { discard: true });
}

function isTheSameClient(before: RecordedConnection, after: RecordedConnection): boolean {
  const [was, is] = [before.credential, after.credential];
  return was.issuer === is.issuer && was.client_id === is.client_id && was.client_source === is.client_source;
}

function tokensReplacedOf(before: KeptConnection, after: KeptConnection, services: Forgetting): Effect.Effect<void> {
  if (connectsThroughItsGateway(before.connection)) {
    return replacedKeyEndedOf(before, services);
  }
  return isTheSameClient(before.connection, after.connection)
    ? secretForgottenOf(before, services)
    : forgottenCredentialOf(before, services);
}

export function replacedCredentialOf(
  before: KeptConnection,
  after: KeptConnection,
  services: Forgetting,
): Effect.Effect<void> {
  return Effect.andThen(tokensReplacedOf(before, after, services), releasedClientsForgottenOf(before, after, services));
}
