import { Function, Redacted } from 'effect';

import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { RegisteredClient } from '../consent/client-sources.ts';
import type {
  ConsentCallAnswer,
  ConsentClient,
  ConsentClientOptions,
  ConsentStep,
  ConsentWay,
  StartAsked,
  UnansweredCall,
} from '../consent/consent-client.ts';
import { makeConsentClient } from '../consent/consent-making.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
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

export function hostOf({ origin }: { readonly origin: string }): string {
  return new URL(origin).host;
}

export function unansweredCall(
  step: ConsentStep,
  server: { readonly origin: string },
  answer: ConsentCallAnswer,
): UnansweredCall {
  return { refused: 'unanswered', call: { step, host: hostOf(server), answer } };
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
