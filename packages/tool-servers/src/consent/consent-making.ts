import { Effect } from 'effect';

import { overFetches } from '../call-fetch/over-fetches.ts';
import type { GatewayRequests } from '../consent-through-a-gateway/gateway-consents.ts';
import { serviceClientsListed, throughAutoOf, usableClientsOf } from '../consent-through-auto/auto-clients.ts';
import { heldAmongSecrets, resourcesRecordedBy } from '../consent-tokens/kept-tokens.ts';
import type { RenewedTokens } from '../consent-tokens/renewed-tokens.ts';
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

async function requestsOf(options: LoadedOptions): Promise<GatewayRequests> {
  const [{ consentRequests }, { throughGateways }] = await Promise.all([
    import('../consent-through-auto/consents-by-source.ts'),
    import('../consent-through-a-gateway/gateway-consents.ts'),
  ]);
  return throughGateways(consentRequests(options), options);
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
  loaded: Effect.Effect<GatewayRequests>,
  served: ConsentServed,
  serving: TokenServing,
): RenewedTokens {
  const heldAt = serving.now();
  heldAmongSecrets(served.held.tokens, serving);
  const sourcing: { source?: Promise<RenewedTokens>; sourced?: RenewedTokens } = {};
  const sourceOnUse = (): Promise<RenewedTokens> => {
    sourcing.source ??= Effect.runPromise(
      Effect.map(loaded, (requests) => {
        sourcing.sourced = requests.tokenSource({ served, heldAt, serving });
        return sourcing.sourced;
      }),
    );
    return sourcing.source;
  };
  return {
    token: async () => (await sourceOnUse()).token(),
    onUnauthorized: async (context) => {
      await (await sourceOnUse()).onUnauthorized(context);
    },
    recordedResources: () =>
      sourcing.sourced === undefined ? resourcesRecordedBy(served.held.tokens) : sourcing.sourced.recordedResources(),
  };
}

interface Consenting {
  readonly options: LoadedOptions;
  readonly requests: Effect.Effect<GatewayRequests>;
}

function consentingWith(given: ConsentClientOptions, keeping: Keeping): Consenting {
  const options = loadedOf(given, keeping);
  const loading: { requests?: Promise<GatewayRequests> } = {};
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
  const requested = <A, E>(asking: (requests: GatewayRequests) => Effect.Effect<A, E>) =>
    Effect.flatMap(consenting.ofTheCall, ({ requests }) => Effect.flatMap(requests, asking));
  return {
    hadSources: (studioBase) =>
      Effect.flatMap(consenting.ofTheCall, ({ options }) => hadSourcesOf(options, studioBase)),
    namedWay: (asked) => requested((requests) => requests.namedWay(asked)),
    start: (asked) => requested((requests) => requests.start(asked)),
    finish: (asked) => requested((requests) => requests.finish(asked)),
    tokenSource: (served, serving) =>
      servedTokens(consenting.over(serving.fetch ?? given.fetch).requests, served, serving),
    revoke: (asked) => requested((requests) => requests.revoke(asked)),
    end: (asked) => requested((requests) => requests.end(asked)),
    endTried: (asked, unended) => requested((requests) => requests.endTried(asked, unended)),
  };
}
