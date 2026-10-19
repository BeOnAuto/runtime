import { exchangeAuthorization, startAuthorization, type FetchLike } from '@modelcontextprotocol/client';
import { fetchWithin, type Reaches } from '@on.auto/outbound';
import { DateTime, Effect, Option, Redacted, Schema } from 'effect';

import { clientChoice, libraryClientOf, type ClientChoice } from './acting-clients.ts';
import type {
  ConsentClientOptions,
  ConsentRefusal,
  FinishAsked,
  FinishedConsent,
  StartAsked,
  StartedConsent,
} from './consent-client.ts';
import { exchangeRefusalOf } from './consent-failures.ts';
import { revocationOf } from './revocation.ts';
import { isScope, normalizedScopeOf } from './scopes.ts';
import { libraryMetadataOf, scopeAskedOf, serverMetadataOf } from './server-metadata.ts';

export interface ConsentRequests {
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
}

interface Requesting extends ConsentClientOptions {
  readonly requestMs: number;
}

interface Requests {
  readonly clients: ClientChoice;
  readonly fetchFor: (reaches: Reaches) => FetchLike;
}

const TokensSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
});

type Tokens = typeof TokensSchema.Type;

const tokensOf = Schema.decodeUnknownSync(TokensSchema);

const noScope: ConsentRefusal = { refused: 'no_scope' };

const malformedScope: ConsentRefusal = { refused: 'malformed_scope' };

const millisOfASecond = 1000;

function boundedFetchOf(fetch: FetchLike, reaches: Reaches, requestMs: number): FetchLike {
  const within = fetchWithin(fetch, reaches);
  return (...[address, init]: readonly [unknown, unknown?]) =>
    within(String(address), Object.assign({}, init, { signal: AbortSignal.timeout(requestMs) }));
}

function grantedScopeOf(granted: string | undefined, asked: string | undefined) {
  if (granted === undefined) {
    return Effect.succeed(asked);
  }
  const scope = normalizedScopeOf(granted);
  if (scope === '') {
    return asked === undefined ? Effect.undefined : Effect.fail(noScope);
  }
  return isScope(scope) ? Effect.succeed(scope) : Effect.fail(malformedScope);
}

function expiryOf(nowMillis: number, expiresIn: number | undefined): string | undefined {
  return expiresIn === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(nowMillis + expiresIn * millisOfASecond), DateTime.formatIso));
}

function keptTokensOf(
  { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType }: Tokens,
  scope: string | undefined,
  expiresAt: string | undefined,
): Readonly<Record<string, string>> {
  return {
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    ...(scope === undefined ? {} : { scope }),
    token_type: tokenType,
  };
}

function consentOf(
  exchanged: unknown,
  asked: string | undefined,
  revoked: Effect.Effect<void>,
): Effect.Effect<FinishedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const tokens = tokensOf(exchanged);
    const scope = yield* grantedScopeOf(tokens.scope, asked);
    const expiresAt = expiryOf(DateTime.toEpochMillis(yield* DateTime.now), tokens.expires_in);
    return { tokens: Redacted.make(JSON.stringify(keptTokensOf(tokens, scope, expiresAt))), scope, revoked };
  });
}

function started(asked: StartAsked, { clients, fetchFor }: Requests): Effect.Effect<StartedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const fetch = fetchFor(asked.reaches);
    const { server, resource } = yield* serverMetadataOf(asked, fetch);
    const client = yield* clients.chosenAt({ asked, server, fetch });
    const scope = scopeAskedOf(asked.way, server);
    const { authorizationUrl, codeVerifier } = yield* Effect.promise(() =>
      startAuthorization(asked.way.issuer, {
        metadata: libraryMetadataOf(server),
        clientInformation: libraryClientOf(client.identity),
        redirectUrl: asked.returnAddress,
        state: asked.state,
        ...(scope === undefined ? {} : { scope }),
        ...(resource === undefined ? {} : { resource }),
      }),
    );
    for (const [name, value] of Object.entries(asked.way.parameters ?? {})) {
      authorizationUrl.searchParams.set(name, value);
    }
    return { url: authorizationUrl.href, verifier: Redacted.make(codeVerifier), client: client.chosen };
  });
}

function finished(asked: FinishAsked, { clients, fetchFor }: Requests): Effect.Effect<FinishedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const fetch = fetchFor(asked.reaches);
    const { server, resource } = yield* serverMetadataOf(asked, fetch);
    const client = yield* clients.recordedFor(asked);
    const exchanged = yield* Effect.tryPromise({
      try: () =>
        exchangeAuthorization(asked.way.issuer, {
          metadata: libraryMetadataOf(server),
          clientInformation: libraryClientOf(client.identity),
          authorizationCode: asked.code,
          codeVerifier: Redacted.value(asked.verifier),
          redirectUri: asked.returnAddress,
          fetchFn: fetch,
          ...(asked.iss === undefined ? {} : { iss: asked.iss }),
          ...(resource === undefined ? {} : { resource }),
          ...(client.authentication === undefined ? {} : { addClientAuthentication: client.authentication }),
        }),
      catch: exchangeRefusalOf,
    });
    const tokens = { access_token: exchanged.access_token, refresh_token: exchanged.refresh_token };
    const revoked = revocationOf({ server, client, tokens, fetch });
    return yield* consentOf(exchanged, scopeAskedOf(asked.way, server), revoked).pipe(Effect.onError(() => revoked));
  });
}

export function consentRequests(options: Requesting): ConsentRequests {
  const requests: Requests = {
    clients: clientChoice(options),
    fetchFor: (reaches) => boundedFetchOf(options.fetch, reaches, options.requestMs),
  };
  return {
    start: (asked) => started(asked, requests),
    finish: (asked) => finished(asked, requests),
  };
}
