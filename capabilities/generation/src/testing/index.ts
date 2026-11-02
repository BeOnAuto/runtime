export { audioSource, imageSource, referringSource, sourceWith, videoSource } from './documents.ts';
export {
  answeredByKind,
  answeredWith,
  costHeader,
  fakeGateway,
  fakeGatewaySettings,
  onePixelPng,
  spokenBytes,
  type AskedOfTheGateway,
  type FakeGateway,
  type GatewayAnswering,
} from './gateway-fakes.ts';
export { generationHarness, harnessStartsAt, type GenerationHarness } from './generation-harness.ts';
export { acmeAdmin, alpha, clockAt } from './harness-calls.ts';
export { testCatalog, testEntries } from './test-catalog.ts';
