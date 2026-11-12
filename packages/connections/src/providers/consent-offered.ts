import type {
  ClientSource,
  HadSources,
  WayClientSource,
  WayGateway,
  WayOfClients,
  WayPkce,
} from '@on.auto/tool-servers';

import { notReachedHereWords } from '../page/consent-words.ts';

interface WayOfConsent {
  readonly issuer?: string;
  readonly scope?: string;
  readonly clients?: readonly WayClientSource[];
  readonly pkce?: WayPkce;
  readonly gateway?: WayGateway;
}

export type ConsentOffered = { readonly client_source: ClientSource } | { readonly because: string };

function throughARegisteredClient(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers`;
}

function wayOfClientsOf({ issuer, scope, clients, pkce, gateway }: WayOfConsent): WayOfClients {
  return {
    issuer: String(issuer),
    scope,
    clients,
    pkce,
    ...(gateway === undefined ? {} : { gateway: { url: gateway.url } }),
  };
}

function scopelessOf({ scope: _scope, ...way }: WayOfConsent): WayOfConsent {
  return way;
}

function unsetUpWordsOf(provider: string, way: WayOfConsent, consent: HadSources): string {
  if (way.gateway !== undefined) {
    return notReachedHereWords(provider);
  }
  return consent.sourcesOf(wayOfClientsOf(scopelessOf(way))).length === 0
    ? `${throughARegisteredClient(provider)}, which is not set up here`
    : `${throughARegisteredClient(provider)}, and no client set up here covers every scope its way asks, ${String(way.scope)}`;
}

export function consentOfferedOf(provider: string, way: WayOfConsent, consent: HadSources): ConsentOffered {
  const source = consent.sourceOf(wayOfClientsOf(way));
  return source === undefined ? { because: unsetUpWordsOf(provider, way, consent) } : { client_source: source };
}
