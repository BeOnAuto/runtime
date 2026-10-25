import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
import type { ServiceListing, ThroughAuto } from './auto-consents.ts';
import { consentRegistration } from './consent-fakes.ts';
import { serveFakeConsentService } from './fake-consent-service.ts';
import { clockAt } from './served-consents.ts';

export function servedForConsent(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  return serveFakeMcp({ client: consentRegistration(changes) });
}

export async function servedThroughAuto(
  changes: Partial<ClientRegistration> = {},
  listing: ServiceListing = {},
): Promise<ThroughAuto> {
  const fake = await servedForConsent(changes);
  const clock = clockAt(0);
  const service = await serveFakeConsentService({ vendor: fake, now: clock.now, ...listing });
  return {
    fake,
    service,
    clock,
    close: async () => {
      await Promise.all([service.close(), fake.close()]);
    },
  };
}
