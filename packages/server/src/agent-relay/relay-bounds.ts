import { heartbeatEveryMs } from '@on.auto/api';

const silenceMs = 3 * heartbeatEveryMs;

const pingTimeoutMs = 2000;

const pingTries = 3;

const pingSpacingMs = 1000;

const heardBackWithinMs = 45_000;

const graceMs = 5000;

export interface RelayBounds {
  readonly silenceMs: number;
  readonly pingTimeoutMs: number;
  readonly pingTries: number;
  readonly pingSpacingMs: number;
  readonly heardBackWithinMs: number;
  readonly graceMs: number;
}

export const relayBounds: RelayBounds = {
  silenceMs,
  pingTimeoutMs,
  pingTries,
  pingSpacingMs,
  heardBackWithinMs,
  graceMs,
};
