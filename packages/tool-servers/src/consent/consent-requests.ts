import { exchangeAuthorization, startAuthorization } from '@modelcontextprotocol/client';
import { DateTime, Effect, Redacted } from 'effect';

import { answeredTokensOf, keptOf, keptValueOf } from '../consent-tokens/kept-tokens.ts';
import { tokenRequestsOf, type TokenRequesting, type TokenRequests } from '../consent-tokens/token-requests.ts';
import { libraryClientOf, requestsOf, type Requests } from './acting-clients.ts';
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

export interface ConsentRequests extends TokenRequests {
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
}

type Requesting = ConsentClientOptions & TokenRequesting;

const noScope: ConsentRefusal = { refused: 'no_scope' };

const malformedScope: ConsentRefusal = { refused: 'malformed_scope' };

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

function consentOf(
  exchanged: unknown,
  asked: string | undefined,
  revoked: Effect.Effect<void>,
): Effect.Effect<FinishedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const tokens = answeredTokensOf(exchanged);
    const scope = yield* grantedScopeOf(tokens.scope, asked);
    const kept = keptOf(tokens, scope, DateTime.toEpochMillis(yield* DateTime.now));
    return { tokens: keptValueOf(kept), scope, revoked };
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
    const revoking = Effect.ignore(revocationOf({ server, client, tokens, fetch }));
    return yield* consentOf(exchanged, scopeAskedOf(asked.way, server), revoking).pipe(Effect.onError(() => revoking));
  });
}

export function consentRequests(options: Requesting): ConsentRequests {
  const requests = requestsOf(options);
  return {
    start: (asked) => started(asked, requests),
    finish: (asked) => finished(asked, requests),
    ...tokenRequestsOf(requests, options),
  };
}
