import { heartbeatEveryMs } from '@on.auto/api';

import { longestStopMs } from '../lifecycle/shutdown.ts';

const silenceMs = 3 * heartbeatEveryMs;

const pingTimeoutMs = 2000;

const pingTries = 3;

const pingSpacingMs = 1000;

const heardBackWithinMs = 45_000;

const graceMs = 5000;

const killWithinMs = 2000;

export interface RelayBounds {
  readonly silenceMs: number;
  readonly pingTimeoutMs: number;
  readonly pingTries: number;
  readonly pingSpacingMs: number;
  readonly heardBackWithinMs: number;
  readonly graceMs: number;
  readonly stopWithinMs: number;
  readonly killWithinMs: number;
}

export const relayBounds: RelayBounds = {
  silenceMs,
  pingTimeoutMs,
  pingTries,
  pingSpacingMs,
  heardBackWithinMs,
  graceMs,
  stopWithinMs: longestStopMs,
  killWithinMs,
};
