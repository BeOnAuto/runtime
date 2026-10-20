import { Effect, Function, Redacted } from 'effect';

import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { AutoClients, ReturnKind } from '../consent-through-auto/auto-clients.ts';
import { consentServiceOf, type ServiceStartAsked } from '../consent-through-auto/consent-service.ts';
import type {
  ConsentClient,
  ConsentClientOptions,
  ConsentWay,
  HandleFinishAsked,
  StartAsked,
} from '../consent/consent-client.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { consentClientWith, servedForConsent, startAskedAt } from './consent-fakes.ts';
import { serveFakeConsentService, type FakeConsentService } from './fake-consent-service.ts';
import { consentedAt, tokensKeptBy } from './given-consents.ts';
import { clockAt, type ConsentConnected, type ManualClock } from './served-consents.ts';

export interface ThroughAuto {
  readonly fake: FakeMcpServer;
  readonly service: FakeConsentService;
  readonly clock: ManualClock;
  readonly close: () => Promise<void>;
}

export const studioSession = Redacted.make('session-of-a-person-signed-in-to-auto');

export function autoClientsOf(service: Pick<FakeConsentService, 'url'>, kind: ReturnKind = 'hosted'): AutoClients {
  return { enabled: true, service: { url: service.url }, returnKindOf: Function.constant(kind) };
}

export function serviceCallsAt({ url }: Pick<FakeConsentService, 'url'>) {
  return consentServiceOf({
    fetch: globalThis.fetch,
    url,
    requestMs: 5000,
    requestTimeout: (ms) => AbortSignal.timeout(ms),
  });
}

export async function handleOf(service: Pick<FakeConsentService, 'url'>, authorizationUrl: string): Promise<string> {
  const { code, state } = await consentedAt(authorizationUrl);
  const redeemed = await Effect.runPromise(serviceCallsAt(service).redeem(state, studioSession, { code }));
  return redeemed.handle;
}

export async function handedOffAskedOf(
  client: ConsentClient,
  asked: StartAsked,
  service: Pick<FakeConsentService, 'url'>,
): Promise<HandleFinishAsked> {
  const start = await Effect.runPromise(client.start(asked));
  const handle = await handleOf(service, start.url);
  const { server, way, returnAddress, reaches } = asked;
  return { server, way, returnAddress, reaches, client: start.client, verifier: start.verifier, handle };
}

export async function servedThroughAuto(changes: Partial<ClientRegistration> = {}): Promise<ThroughAuto> {
  const fake = await servedForConsent(changes);
  const clock = clockAt(0);
  const service = await serveFakeConsentService({ vendor: fake, now: clock.now });
  return {
    fake,
    service,
    clock,
    close: async () => {
      await Promise.all([service.close(), fake.close()]);
    },
  };
}

export function consentClientThrough(
  { service }: Pick<ThroughAuto, 'service'>,
  options: Partial<ConsentClientOptions> = {},
): ConsentClient {
  return consentClientWith({ autoClients: autoClientsOf(service), renewalSpreadMs: 0, ...options });
}

export async function connectedThroughAuto(
  { fake, service }: Pick<ThroughAuto, 'fake' | 'service'>,
  way: Partial<ConsentWay> = {},
): Promise<ConsentConnected> {
  const consent = consentClientThrough({ service });
  const asked = await handedOffAskedOf(consent, startAskedAt(fake, way), service);
  const finished = await Effect.runPromise(consent.finish(asked));
  return { fake, client: asked.client, tokens: finished.tokens, kept: tokensKeptBy(finished) };
}

export async function redeemedThrough({ service }: Pick<ThroughAuto, 'service'>, start: ServiceStartAsked) {
  const calls = serviceCallsAt(service);
  const started = await Effect.runPromise(calls.start(start));
  const { code } = await consentedAt(started.url);
  const redeemed = await Effect.runPromise(calls.redeem(started.state, studioSession, { code }));
  return { started, code, handle: redeemed.handle };
}

export async function postedToTheService(
  { url }: Pick<FakeConsentService, 'url'>,
  path: string,
  body: string,
  headers: Readonly<Record<string, string>> = {},
) {
  const answer = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  return { status: answer.status, body: await answer.text() };
}
