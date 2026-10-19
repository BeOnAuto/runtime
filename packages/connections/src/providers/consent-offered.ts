import type { ClientSource, ConsentClient } from '@on.auto/tool-servers';

export type ClientSourcesHad = Pick<ConsentClient, 'sourcesOf'>;

interface WayOfConsent {
  readonly kind: string;
  readonly issuer?: string;
  readonly clients?: readonly ClientSource[];
}

export function consentUnsetUp(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers, which is not set up here`;
}

export function isConsentUnsetUp(way: WayOfConsent, consent: ClientSourcesHad): boolean {
  return (
    way.kind === 'authorization' && consent.sourcesOf({ issuer: String(way.issuer), clients: way.clients }).length === 0
  );
}
