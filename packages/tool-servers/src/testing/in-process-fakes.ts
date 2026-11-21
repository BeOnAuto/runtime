import {
  basePath,
  documentPath,
  fakeApiAnswers,
  type FakeApiOptions,
  type FakeApiServer,
} from '../api-testing/fake-api-answers.ts';
import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { ServiceListing, ThroughAuto } from '../consent-testing/auto-consents.ts';
import { consentRegistration } from '../consent-testing/consent-fakes.ts';
import { fakeConsentServiceAnswers, type FakeConsentService } from '../consent-testing/fake-consent-answers.ts';
import type { FakeConsentServiceOptions } from '../consent-testing/fake-consent-store.ts';
import { fakeGatewayAnswers, type FakeGateway, type FakeGatewayOptions } from '../consent-testing/fake-gateway.ts';
import { clockAt } from '../consent-testing/served-consents.ts';
import { fakeMcpAnswers, type FakeMcpOptions, type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { inProcessFetch, serveInProcess, type InProcessFetch } from './in-process.ts';

export interface Fetching {
  readonly fetch: InProcessFetch;
}

export function fakeMcpInProcess(options: FakeMcpOptions = {}): FakeMcpServer & Fetching {
  const { handlerAt, ...answers } = fakeMcpAnswers({ realSleep: false, ...options });
  const served = serveInProcess(handlerAt, 'mcp');
  return {
    ...answers,
    ...served,
    url: `${served.origin}/mcp`,
    close: async () => {
      answers.forgetSessions();
      await served.close();
    },
  };
}

export function fakeApiInProcess(options: FakeApiOptions = {}): FakeApiServer & Fetching {
  const answers = fakeApiAnswers(options);
  const issuing =
    answers.issuing === undefined
      ? undefined
      : { ...answers.issuing, ...serveInProcess(answers.issuing.handlerAt, 'issuer') };
  const served = serveInProcess(() => answers.handler, 'api');
  const hearing = issuing === undefined ? [served] : [served, issuing];
  return {
    origin: served.origin,
    fetch: inProcessFetch,
    baseUrl: `${served.origin}${basePath}`,
    documentUrl: `${served.origin}${documentPath}`,
    issuing:
      issuing === undefined
        ? undefined
        : { issuer: issuing.origin, tokenRequests: issuing.tokenRequests, revokeTokens: issuing.revokeTokens },
    seen: answers.seen,
    heard: () => hearing.flatMap((each) => each.heard()),
    documentReads: answers.documentReads,
    answerNextWith: answers.answerNextWith,
    close: async () => {
      await Promise.all(hearing.map((each) => each.close()));
    },
  };
}

export function fakeConsentServiceInProcess(options: FakeConsentServiceOptions): FakeConsentService & Fetching {
  const { handler, ...answers } = fakeConsentServiceAnswers(options);
  const served = serveInProcess(() => handler, 'consent');
  return { ...answers, url: served.origin, fetch: inProcessFetch, close: served.close };
}

export function fakeGatewayInProcess(options: FakeGatewayOptions = {}): FakeGateway & Fetching {
  const answers = fakeGatewayAnswers(options);
  return answers.gatewayAt(serveInProcess(answers.handlerAt, 'gateway'));
}

export function forConsentInProcess(changes: Partial<ClientRegistration> = {}): FakeMcpServer & Fetching {
  return fakeMcpInProcess({ client: consentRegistration(changes) });
}

export function throughAutoInProcess(
  changes: Partial<ClientRegistration> = {},
  listing: ServiceListing = {},
): ThroughAuto & Fetching {
  const fake = forConsentInProcess(changes);
  const clock = clockAt(0);
  const service = fakeConsentServiceInProcess({ vendor: fake, now: clock.now, ...listing });
  return {
    fake,
    service,
    clock,
    fetch: inProcessFetch,
    close: async () => {
      await Promise.all([service.close(), fake.close()]);
    },
  };
}
