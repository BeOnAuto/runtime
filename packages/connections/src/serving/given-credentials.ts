import type { ConnectionTokens, ConnectionUnready, ConsentAuth, TokensEnded } from '@on.auto/tool-servers';
import { DateTime, Effect, Option, type Context } from 'effect';

import type { KeptSecret } from '../operations/connection-services.ts';
import { consentAskedOf } from '../page/consent-asking.ts';
import { placesNoValue } from '../registry/credential.ts';
import { byTheRuntime, connectionsStreamOfOrg, registryDecider } from '../registry/registry-decider.ts';
import type { GivenValue } from './placed-credentials.ts';
import type { Serving } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

export type Given = Effect.Effect<GivenValue | undefined, ConnectionUnready>;

const endedWords: Readonly<Record<TokensEnded, (name: string) => string>> = {
  consent_ended: servingWords.consentEnded,
  client_gone: servingWords.clientGone,
};

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

export function notAllowed(detail: string): ConnectionUnready {
  return { because: 'connection_not_allowed', detail };
}

function brokenWith({ org, kept, services }: Serving, reason: string): Effect.Effect<never, ConnectionUnready> {
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const breaking = { type: 'break', connection: kept.connection.id, reason, by: byTheRuntime, at } as const;
    yield* services.registry.execute(connectionsStreamOfOrg(org), registryDecider, breaking).pipe(
      Effect.orDie,
      Effect.catchCause((cause) => Effect.logError(servingWords.unrecorded(kept.connection.name), cause)),
    );
    const unready: ConnectionUnready = { because: 'connection_broken', detail: reason };
    return yield* Effect.fail(unready);
  });
}

function keptSecretOf(serving: Serving): Effect.Effect<KeptSecret, ConnectionUnready> {
  const { name } = serving.kept.connection;
  return serving.services.secrets.read(required(serving.kept.secretId)).pipe(
    Effect.matchEffect({
      onFailure: ({ detail }) => brokenWith(serving, servingWords.unreadable(name, detail)),
      onSuccess: (stored) =>
        stored === undefined ? brokenWith(serving, servingWords.gone(name)) : Effect.succeed(stored),
    }),
  );
}

function referencedOf({ kept, services }: Serving): Given {
  const { credential, name } = kept.connection;
  const variable = required(credential.variable);
  const value = services.variables.get(variable);
  return value === undefined
    ? Effect.fail(notAllowed(servingWords.unset(name, variable)))
    : Effect.succeed({ value, algorithm: undefined });
}

export function givenOf(serving: Serving): Given {
  const { kind } = serving.kept.connection.credential;
  if (placesNoValue(kind)) {
    return Effect.undefined;
  }
  return kind === 'reference'
    ? referencedOf(serving)
    : Effect.map(keptSecretOf(serving), ({ value }) => ({ value, algorithm: serving.kept.algorithm }));
}

function tokensOfTheRow(serving: Serving, context: Context.Context<never>): ConnectionTokens {
  const secretId = required(serving.kept.secretId);
  const { secrets } = serving.services;
  const { name } = serving.kept.connection;
  return {
    read: Effect.provideContext(keptSecretOf(serving), context),
    replace: (version, value) => Effect.provideContext(secrets.replace(secretId, version, value), context),
    claim: (version, lastingMs) => Effect.provideContext(secrets.claim(secretId, version, lastingMs), context),
    broken: (ended) => Effect.provideContext(brokenWith(serving, endedWords[ended](name)), context),
  };
}

export function consentAuthOf(serving: Serving): Effect.Effect<ConsentAuth | undefined, ConnectionUnready> {
  const { connection } = serving.kept;
  const { credential } = connection;
  if (credential.kind !== 'authorization') {
    return Effect.undefined;
  }
  return Effect.gen(function* () {
    const held = yield* keptSecretOf(serving);
    const context = yield* Effect.context();
    const asked = consentAskedOf(connection, serving.services);
    const client = { client_id: required(credential.client_id), client_source: required(credential.client_source) };
    return {
      issuer: asked.way.issuer,
      client_id: client.client_id,
      scope: credential.scope ?? null,
      credential: { kind: 'consent', ...asked, client, held, tokens: tokensOfTheRow(serving, context) },
    };
  });
}
