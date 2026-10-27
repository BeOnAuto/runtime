import { defaultTiming, type Timing } from '../bounds/call-bounds.ts';

export {
  fakeMcpAnswers,
  type FakeMcpAnswers,
  type FakeMcpOptions,
  type FakeMcpServer,
  type SeenRequest,
} from '../mcp-testing/fake-mcp-answers.ts';
export {
  fakeApiAnswers,
  type FakeApiAnswers,
  type FakeApiOptions,
  type FakeApiServer,
  type FakeIssuing,
  type IssuingAnswers,
} from '../api-testing/fake-api-answers.ts';
export type { FailedRequest, FetchHandler, HeardRequest, LoopbackServer } from './fetch-handler.ts';
export type { SeenApiRequest } from '../api-testing/fake-api-routes.ts';
export { fakeApiDocument, fakeApiToolNames, type FakeApiVersion } from '../api-testing/fake-api-document.ts';
export { chatBot, type ChatMessage, type ChatReply, type FakeChat } from '../mcp-testing/fake-chat.ts';
export type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
export { admitted, postedTo } from '../authorization-testing/authorization-requests.ts';
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
  registeredAfterAnother,
  registeredAt,
  returnAddress,
  startAskedAt,
  studioBase,
} from '../consent-testing/consent-fakes.ts';
export {
  fakeConsentServiceAnswers,
  type FakeConsentService,
  type FakeConsentServiceAnswers,
  type ServiceCall,
} from '../consent-testing/fake-consent-answers.ts';
export type { FakeConsentServiceOptions, RefusedCall } from '../consent-testing/fake-consent-store.ts';
export {
  autoClientsOf,
  connectedThroughAuto,
  consentClientThrough,
  handedOffAskedOf,
  handleOf,
  serviceCallsAt,
  studioSession,
  type ServiceListing,
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
export {
  brokenAtTheChallenge,
  challengedWith,
  cuttingTimeouts,
  failingAt,
  gatedRequests,
  hostRefusedAt,
  metadataWithdrawnFrom,
  pingAnsweredWith,
  recordedFetch,
  type CuttingTimeouts,
  type GatedRequests,
  type RecordedFetch,
  type WithdrawnMetadata,
} from '../consent-testing/gated-requests.ts';
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

export const patientTiming: Timing = { ...defaultTiming, callMs: 20_000, openMs: 20_000 };
