import { Function, Redacted } from 'effect';

import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { RegisteredClient } from '../consent/client-sources.ts';
import type { ConsentClient, ConsentClientOptions, ConsentWay, StartAsked } from '../consent/consent-client.ts';
import { makeConsentClient } from '../consent/consent-making.ts';
import { serveFakeMcp, type FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { memoryRegistrations } from './given-consents.ts';

export const studioBase = 'https://studio.example.com/';

export const returnAddress = `${studioBase}connect-return`;

export const consentSecret = 'auto-runtime-client-secret-3c9e';

export const everyHost: (url: string) => string | undefined = Function.constUndefined;

export function consentRegistration(changes: Partial<ClientRegistration> = {}): ClientRegistration {
  return {
    clientId: 'auto-runtime',
    clientSecret: consentSecret,
    expiresInSeconds: 3600,
    redirectUris: [returnAddress],
    ...changes,
  };
}

export function servedForConsent(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  return serveFakeMcp({ client: consentRegistration(changes) });
}

export function registeredAt(issuer: string, changes: Partial<RegisteredClient> = {}): RegisteredClient {
  return {
    issuers: [issuer],
    clientId: 'auto-runtime',
    credential: { kind: 'client_secret', clientSecret: Redacted.make(consentSecret) },
    tokenEndpointAuthMethod: null,
    ...changes,
  };
}

export function registeredAfterAnother(issuer: string): readonly RegisteredClient[] {
  return [
    registeredAt(issuer, { clientId: 'standing-first', scopes: ['files.read'] }),
    registeredAt(issuer, { scopes: ['files.read'] }),
  ];
}

export function consentClientWith(options: Partial<ConsentClientOptions> = {}): ConsentClient {
  return makeConsentClient({
    fetch: globalThis.fetch,
    registeredClients: [],
    publicUrl: undefined,
    registrations: memoryRegistrations(),
    ...options,
  });
}

export function startAskedAt(fake: FakeMcpServer, way: Partial<ConsentWay> = {}, state = 'state-1'): StartAsked {
  return {
    server: { type: 'mcp', url: fake.url },
    way: { issuer: fake.origin, scope: 'files.read', ...way },
    returnAddress,
    reaches: everyHost,
    state,
    studioBase,
  };
}
