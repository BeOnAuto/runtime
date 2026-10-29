import type { HadSources, WayClientSource } from '@on.auto/tool-servers';

interface WayOfConsent {
  readonly kind: string;
  readonly issuer?: string;
  readonly scope?: string;
  readonly clients?: readonly WayClientSource[];
}

function throughARegisteredClient(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers`;
}

function isConsentUnsetUp(way: WayOfConsent, consent: HadSources): boolean {
  return (
    way.kind === 'authorization' &&
    consent.sourcesOf({ issuer: String(way.issuer), scope: way.scope, clients: way.clients }).length === 0
  );
}

function scopelessOf({ scope: _scope, ...way }: WayOfConsent): WayOfConsent {
  return way;
}

export interface ConsentUnsetUp {
  readonly detail: string;
  readonly scopeUncovered: boolean;
}

export function consentUnsetUpOf(provider: string, way: WayOfConsent, consent: HadSources): ConsentUnsetUp | undefined {
  if (!isConsentUnsetUp(way, consent)) {
    return undefined;
  }
  return isConsentUnsetUp(scopelessOf(way), consent)
    ? { detail: `${throughARegisteredClient(provider)}, which is not set up here`, scopeUncovered: false }
    : {
        detail: `${throughARegisteredClient(provider)}, and no client set up here covers every scope its way asks, ${String(way.scope)}`,
        scopeUncovered: true,
      };
}
