import type { HadSources, WayClientSource, WayOfClients, WayPkce } from '@on.auto/tool-servers';

interface WayOfConsent {
  readonly kind: string;
  readonly issuer?: string;
  readonly scope?: string;
  readonly clients?: readonly WayClientSource[];
  readonly pkce?: WayPkce;
}

function throughARegisteredClient(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers`;
}

function wayOfClientsOf({ issuer, scope, clients, pkce }: WayOfConsent): WayOfClients {
  return { issuer: String(issuer), scope, clients, pkce };
}

function isConsentUnsetUp(way: WayOfConsent, consent: HadSources): boolean {
  return way.kind === 'authorization' && consent.sourcesOf(wayOfClientsOf(way)).length === 0;
}

function scopelessOf({ scope: _scope, ...way }: WayOfConsent): WayOfConsent {
  return way;
}

export function consentUnsetUpOf(provider: string, way: WayOfConsent, consent: HadSources): string | undefined {
  if (!isConsentUnsetUp(way, consent)) {
    return undefined;
  }
  return isConsentUnsetUp(scopelessOf(way), consent)
    ? `${throughARegisteredClient(provider)}, which is not set up here`
    : `${throughARegisteredClient(provider)}, and no client set up here covers every scope its way asks, ${String(way.scope)}`;
}
