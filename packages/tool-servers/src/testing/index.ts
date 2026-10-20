import { fileURLToPath } from 'node:url';

import { defaultTiming, type Timing } from '../bounds/call-bounds.ts';

export {
  serveFakeMcp,
  type FakeMcpOptions,
  type FakeMcpServer,
  type SeenRequest,
} from '../mcp-testing/fake-mcp-server.ts';
export { serveFakeApi, type FakeApiOptions, type FakeApiServer } from '../api-testing/fake-api-server.ts';
export type { SeenApiRequest } from '../api-testing/fake-api-routes.ts';
export { fakeApiDocument, fakeApiToolNames, type FakeApiVersion } from '../api-testing/fake-api-document.ts';
export { chatBot, type ChatMessage, type ChatReply, type FakeChat } from '../mcp-testing/fake-chat.ts';
export type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
export { admitted } from '../authorization-testing/authorization-requests.ts';
export {
  deniedText,
  fakeChannels,
  fakeRequestIdKey,
  fakeToolNames,
  longToolName,
  verboseDescription,
  type FakeHints,
  type ReceivedCall,
} from '../mcp-testing/fake-tools.ts';
export { brokenPromise, threadReplies } from '../mcp-testing/fake-data-tools.ts';
export { fetchWithDeletion } from '../mcp-testing/deleting-fetch.ts';
export { fakeApiKey, openFakeToolRun, type FakeToolRun } from './fake-tool-run.ts';
export { recordingTimer, type RecordingTimer, type Wait } from './recording-timer.ts';
export { pendingWords } from './fake-connections.ts';
export {
  playbookToolCalls,
  toolCaller,
  toolReader,
  type Asking,
  type PlaybookTool,
  type PlaybookToolCalls,
  type WritesOptions,
} from './playbook-tool-calls.ts';
export {
  describedAccess,
  noToolServers,
  reportingAccess,
  testClientInfo,
  type AccessOptions,
  type ReportingAccess,
} from './reporting-access.ts';
export {
  controlledSignals,
  inTurn,
  recordingCallJournal,
  toolRun,
  toolRunId,
  type ControlledSignals,
  type RecordingCallJournal,
} from './tool-runs.ts';

export {
  consentedAt,
  finishAskedOf,
  memoryRegistrations,
  tokensKeptBy,
  type Consented,
  type MemoryRegistrations,
} from '../consent-testing/given-consents.ts';
export {
  consentClientWith,
  consentRegistration,
  consentSecret,
  everyHost,
  registeredAt,
  returnAddress,
  servedForConsent,
  startAskedAt,
  studioBase,
} from '../consent-testing/consent-fakes.ts';
export {
  serveFakeConsentService,
  type FakeConsentService,
  type ServiceCall,
} from '../consent-testing/fake-consent-service.ts';
export type { FakeConsentServiceOptions, RefusedCall } from '../consent-testing/fake-consent-store.ts';
export {
  autoClientsOf,
  connectedThroughAuto,
  consentClientThrough,
  handedOffAskedOf,
  handleOf,
  servedThroughAuto,
  serviceCallsAt,
  studioSession,
  type ThroughAuto,
} from '../consent-testing/auto-consents.ts';
export {
  brokenWords,
  goneWords,
  manualTimer,
  memoryTokens,
  servedAt,
  type ManualTimer,
  type MemoryTokens,
} from '../consent-testing/memory-tokens.ts';
export { sealedTokens, type SealedTokens } from '../consent-testing/sealed-tokens.ts';
export { gatedRequests, hostRefusedAt, type GatedRequests } from '../consent-testing/gated-requests.ts';
export {
  clockAt,
  connectedByConsent,
  connectionName,
  consentClientAt,
  rowOf,
  servedOf,
  servedTokensOf,
  type ConsentConnected,
  type ManualClock,
  type ServedTokens,
} from '../consent-testing/served-consents.ts';
export { toolAccessBehaviour } from '../access-testing/tool-access-behaviour.ts';
export {
  behaviourKey,
  serversUnderTest,
  type CredentialUnderTest,
  type ServedUnderTest,
  type ServerUnderTest,
} from '../access-testing/servers-under-test.ts';
export type { SourcedEntry, SourceUnderTest } from '../access-testing/sources-under-test.ts';

export const fakeStdioServerPath = fileURLToPath(new URL('../mcp-testing/fake-stdio-server.ts', import.meta.url));

export const patientTiming: Timing = { ...defaultTiming, callMs: 20_000, openMs: 20_000 };
