import { serveOnLoopback } from '../testing/loopback-server.ts';
import { fakeConsentServiceAnswers, type FakeConsentService } from './fake-consent-answers.ts';
import type { FakeConsentServiceOptions } from './fake-consent-store.ts';

export async function serveFakeConsentService(options: FakeConsentServiceOptions): Promise<FakeConsentService> {
  const { handler, ...answers } = fakeConsentServiceAnswers(options);
  const listening = await serveOnLoopback(() => handler);
  return { ...answers, url: listening.origin, close: listening.close };
}
