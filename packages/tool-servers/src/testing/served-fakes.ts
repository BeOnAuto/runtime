import { fileURLToPath } from 'node:url';

export { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
export type { FakeMcpOptions, FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
export { serveFakeApi } from '../api-testing/fake-api-server.ts';
export type { FakeApiOptions, FakeApiServer } from '../api-testing/fake-api-answers.ts';
export { serveFakeConsentService } from '../consent-testing/fake-consent-service.ts';
export type { FakeConsentService } from '../consent-testing/fake-consent-answers.ts';
export type { FakeConsentServiceOptions } from '../consent-testing/fake-consent-store.ts';
export { servedForConsent, servedThroughAuto } from '../consent-testing/consent-servers.ts';
export type { ServiceListing, ThroughAuto } from '../consent-testing/auto-consents.ts';
export { fakeApiKey, openFakeToolRun, type FakeToolRun } from './fake-tool-run.ts';
export { toolAccessBehaviour } from '../access-testing/tool-access-behaviour.ts';
export {
  behaviourKey,
  serversUnderTest,
  type CredentialUnderTest,
  type ServedUnderTest,
  type ServerUnderTest,
} from '../access-testing/servers-under-test.ts';
export type { SourcedEntry, SourceUnderTest } from '../access-testing/sources-under-test.ts';

export function fakeStdioServerPath(): string {
  return fileURLToPath(new URL('../mcp-testing/fake-stdio-server.ts', import.meta.url));
}
