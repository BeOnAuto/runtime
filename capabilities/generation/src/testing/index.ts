export { audioSource, imageSource, referringSource, sourceWith, videoSource } from './documents.ts';
export {
  answeredByKind,
  answeredInTime,
  answeredWith,
  askedHandle,
  costHeader,
  fakeGateway,
  fakeGatewaySettings,
  filmedBytes,
  madeInTime,
  onePixelPng,
  spokenBytes,
  type AskedOfTheGateway,
  type FakeGateway,
  type GatewayAnswering,
  type VideoScript,
} from './gateway-fakes.ts';
export { generationHarness, harnessStartsAt, type GenerationHarness } from './generation-harness.ts';
export { acmeAdmin, alpha, clockAt } from './harness-calls.ts';
export { shippedWithAFilm } from './shipped-with-a-film.ts';
export { testCatalog, testEntries } from './test-catalog.ts';
