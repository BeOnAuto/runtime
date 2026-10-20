import type { HadSources, WayClientSource } from '@on.auto/tool-servers';

interface WayOfConsent {
  readonly kind: string;
  readonly issuer?: string;
  readonly clients?: readonly WayClientSource[];
}

export function consentUnsetUp(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers, which is not set up here`;
}

export function isConsentUnsetUp(way: WayOfConsent, consent: HadSources): boolean {
  return (
    way.kind === 'authorization' && consent.sourcesOf({ issuer: String(way.issuer), clients: way.clients }).length === 0
  );
}
