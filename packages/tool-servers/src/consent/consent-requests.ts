import { exchangeAuthorization, startAuthorization, type FetchLike } from '@modelcontextprotocol/client';
import { DateTime, Effect, Redacted } from 'effect';

import { answeredTokensOf, keptOf, keptValueOf, tokenAnswersReadAsBearer } from '../consent-tokens/kept-tokens.ts';
import { libraryClientOf, type Requests, type ServerSource } from './acting-clients.ts';
import type {
  CodeFinishAsked,
  ConsentRefusal,
  FinishedConsent,
  NamedWay,
  StartAsked,
  StartedConsent,
  WayAsked,
  WayRefusal,
} from './consent-client.ts';
import { exchangeRefusalOf, observedCalls } from './consent-failures.ts';
import { namedWayOf } from './named-ways.ts';
import { revocationOf } from './revocation.ts';
import { grantedScopeOf } from './scopes.ts';
import {
  handGivenUrlOf,
  libraryMetadataOf,
  scopeAskedOf,
  serverMetadataOf,
  takesNoChallenge,
} from './server-metadata.ts';

export interface ServerConsents {
  readonly namedWay: (asked: WayAsked) => Effect.Effect<NamedWay, WayRefusal>;
  readonly start: (
    asked: StartAsked,
    sources: readonly ServerSource[],
  ) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: CodeFinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
}

function consentOf(
  exchanged: unknown,
  asked: string | undefined,
  revoked: Effect.Effect<void>,
): Effect.Effect<Omit<FinishedConsent, 'client'>, ConsentRefusal> {
  return Effect.gen(function* () {
    const tokens = answeredTokensOf(exchanged);
    const scope = yield* grantedScopeOf(tokens.scope, asked);
    const kept = keptOf(tokens, scope, DateTime.toEpochMillis(yield* DateTime.now));
    return { tokens: keptValueOf(kept), scope, revoked };
  });
}

const promptingForConsent = { prompt: 'consent' };

function parametersOf({ server, way }: StartAsked): Readonly<Record<string, string>> {
  return { ...way.parameters, ...(handGivenUrlOf(server) === undefined ? {} : promptingForConsent) };
}

const challengeParameters = ['code_challenge', 'code_challenge_method'];

function challengeLeftOut(authorizationUrl: Readonly<URL>): void {
  for (const name of challengeParameters) {
    authorizationUrl.searchParams.delete(name);
  }
}

function sentWithoutAVerifier(fetch: FetchLike): FetchLike {
  return async (...[address, init]: readonly [unknown, unknown?]) => {
    const form = new URLSearchParams(await new Request(String(address), Object.assign({}, init)).text());
    form.delete('code_verifier');
    return fetch(String(address), Object.assign({}, init, { body: form }));
  };
}

function started(
  asked: StartAsked,
  { clients, fetchFor }: Requests,
  sources: readonly ServerSource[],
): Effect.Effect<StartedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const fetch = fetchFor(asked.reaches);
    const { server, resource } = yield* serverMetadataOf(asked, fetch);
    const client = yield* clients.chosenAt({ asked, server, fetch, sources });
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
    for (const [name, value] of Object.entries(parametersOf(asked))) {
      authorizationUrl.searchParams.set(name, value);
    }
    if (takesNoChallenge(asked.way)) {
      challengeLeftOut(authorizationUrl);
    }
    const verifier = Redacted.make(codeVerifier);
    return { url: authorizationUrl.href, state: asked.state, verifier, client: client.chosen };
  });
}

function finished(asked: CodeFinishAsked, { clients, fetchFor }: Requests) {
  return Effect.gen(function* () {
    const fetch = fetchFor(asked.reaches);
    const { server, resource } = yield* serverMetadataOf(asked, fetch);
    const client = yield* clients.recordedFor(asked);
    const observed = observedCalls('token', server.token_endpoint, fetch);
    const exchangedBy = takesNoChallenge(asked.way) ? sentWithoutAVerifier(observed.fetch) : observed.fetch;
    const exchanged = yield* Effect.tryPromise({
      try: () =>
        exchangeAuthorization(asked.way.issuer, {
          metadata: libraryMetadataOf(server),
          clientInformation: libraryClientOf(client.identity),
          authorizationCode: asked.code,
          codeVerifier: Redacted.value(asked.verifier),
          redirectUri: asked.returnAddress,
          fetchFn: tokenAnswersReadAsBearer(exchangedBy),
          ...(asked.iss === undefined ? {} : { iss: asked.iss }),
          ...(resource === undefined ? {} : { resource }),
          ...(client.authentication === undefined ? {} : { addClientAuthentication: client.authentication }),
        }),
      catch: (error) => exchangeRefusalOf(error, observed),
    });
    const tokens = { access_token: exchanged.access_token, refresh_token: exchanged.refresh_token };
    const revoking = Effect.ignore(revocationOf({ server, client, tokens, fetch }));
    return yield* consentOf(exchanged, scopeAskedOf(asked.way, server), revoking).pipe(
      Effect.map((consent) => ({ ...consent, client: asked.client })),
      Effect.onError(() => revoking),
    );
  });
}

export function serverConsentsOf(requests: Requests, publicUrl: string | undefined): ServerConsents {
  return {
    namedWay: (asked) => namedWayOf(asked, requests.fetchFor(asked.reaches), publicUrl),
    start: (asked, sources) => started(asked, requests, sources),
    finish: (asked) => finished(asked, requests),
  };
}
