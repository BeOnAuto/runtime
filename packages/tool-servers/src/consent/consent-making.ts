import { Effect } from 'effect';

import { overFetches } from '../call-fetch/over-fetches.ts';
import type { TokenSource } from '../clients/token-source.ts';
import { serviceClientsListed, throughAutoOf, usableClientsOf } from '../consent-through-auto/auto-clients.ts';
import type { ConsentRequests } from '../consent-through-auto/consents-by-source.ts';
import { heldAmongSecrets } from '../consent-tokens/kept-tokens.ts';
import { sourcesHad, sourceTakenOf, type ClientSource, type HadSources, type WayOfClients } from './client-sources.ts';
import type {
  ConsentClient,
  ConsentClientOptions,
  ConsentServed,
  LoadedOptions,
  TokenServing,
} from './consent-client.ts';
import { singleFlight, unkeptRegistrations } from './dynamic-registration.ts';

const mostRenewalSpreadMs = 5000;

async function requestsOf(options: LoadedOptions): Promise<ConsentRequests> {
  const { consentRequests } = await import('../consent-through-auto/consents-by-source.ts');
  return consentRequests(options);
}

type Keeping = Pick<LoadedOptions, 'registeredOnce' | 'unkept'>;

function loadedOf(options: ConsentClientOptions, keeping: Keeping): LoadedOptions {
  const auto = throughAutoOf(options);
  const renewalSpreadMs = options.renewalSpreadMs ?? Math.floor(Math.random() * mostRenewalSpreadMs);
  return { ...options, ...keeping, auto, serviceClients: serviceClientsListed(auto), renewalSpreadMs };
}

function hadSourcesOf(options: LoadedOptions, studioBase: string): Effect.Effect<HadSources> {
  const usable = usableClientsOf(options.auto, studioBase, options.serviceClients);
  return Effect.map(usable, (serviceClients) => ({
    sourcesOf: (way: WayOfClients): readonly ClientSource[] => sourcesHad(way, { ...options, serviceClients }),
    sourceOf: (way: WayOfClients) => sourceTakenOf(way, { ...options, serviceClients }),
  }));
}

function servedTokens(
  loaded: Effect.Effect<ConsentRequests>,
  served: ConsentServed,
  serving: TokenServing,
): TokenSource {
  const heldAt = serving.now();
  heldAmongSecrets(served.held.tokens, serving);
  const sourcing: { source?: Promise<TokenSource> } = {};
  const sourceOnUse = (): Promise<TokenSource> => {
    sourcing.source ??= Effect.runPromise(
      Effect.map(loaded, (requests) => requests.tokenSource({ served, heldAt, serving })),
    );
    return sourcing.source;
  };
  return {
    token: async () => (await sourceOnUse()).token(),
    onUnauthorized: async (context) => {
      await (await sourceOnUse()).onUnauthorized(context);
    },
  };
}

interface Consenting {
  readonly options: LoadedOptions;
  readonly requests: Effect.Effect<ConsentRequests>;
}

function consentingWith(given: ConsentClientOptions, keeping: Keeping): Consenting {
  const options = loadedOf(given, keeping);
  const loading: { requests?: Promise<ConsentRequests> } = {};
  const requests = Effect.promise(() => {
    loading.requests ??= requestsOf(options);
    return loading.requests;
  });
  return { options, requests };
}

export function makeConsentClient(given: ConsentClientOptions): ConsentClient {
  const keeping: Keeping = { registeredOnce: singleFlight(), unkept: unkeptRegistrations() };
  const consenting = overFetches({ fetch: given.fetch, made: consentingWith(given, keeping) }, (fetch) =>
    consentingWith({ ...given, fetch }, keeping),
  );
  const requested = <A, E>(asking: (requests: ConsentRequests) => Effect.Effect<A, E>) =>
    Effect.flatMap(consenting.ofTheCall, ({ requests }) => Effect.flatMap(requests, asking));
  return {
    hadSources: (studioBase) =>
      Effect.flatMap(consenting.ofTheCall, ({ options }) => hadSourcesOf(options, studioBase)),
    start: (asked) => requested((requests) => requests.start(asked)),
    finish: (asked) => requested((requests) => requests.finish(asked)),
    tokenSource: (served, serving) =>
      servedTokens(consenting.over(serving.fetch ?? given.fetch).requests, served, serving),
    revoke: (asked) => requested((requests) => requests.revoke(asked)),
  };
}
