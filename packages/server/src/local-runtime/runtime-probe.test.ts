import { describe, expect, it } from 'vitest';

import { longestStopMs } from '../lifecycle/shutdown.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { restartWaitMs, startWaitMs, throughARestart } from './runtime-probe.ts';

describe('the patience of an agent for a runtime that restarts', () => {
  it('lasts as long as the runtime takes to stop, by the bounds of its shutdown, and then to start', () => {
    const { shutdownTimeoutMs, exitDeadlineMs } = defaultServerOptions;

    expect(throughARestart.waitMs).toBe(restartWaitMs);
    expect(restartWaitMs).toBe(longestStopMs + startWaitMs);
    expect(longestStopMs).toBeGreaterThan(shutdownTimeoutMs + exitDeadlineMs);
  });
});
