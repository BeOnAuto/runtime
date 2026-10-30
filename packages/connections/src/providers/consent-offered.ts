import type { HadSources, WayClientSource, WayPkce } from '@on.auto/tool-servers';

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

function isConsentUnsetUp({ kind, issuer, scope, clients, pkce }: WayOfConsent, consent: HadSources): boolean {
  return kind === 'authorization' && consent.sourcesOf({ issuer: String(issuer), scope, clients, pkce }).length === 0;
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
