import { setTimeout } from 'node:timers/promises';

import { SdkErrorCode } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { manualTimer, recordingTimer } from '../testing/index.ts';
import { longestSdkTimeoutMs, pausedFor, raceAgainst, withinBound } from './timers.ts';

describe('a wait within a bound', () => {
  it('answers what it waited for when that comes in time, and stops the bound', async () => {
    const { timer, waits } = recordingTimer();

    expect(await withinBound(timer, 300, () => Promise.resolve('opened'))).toBe('opened');
    expect(waits()).toEqual([{ ms: 300, stopped: true }]);
  });

  it('is given up as a request that timed out when the bound runs out first', async () => {
    const bound = manualTimer();
    const waiting = withinBound(bound.timer, 300, (signal) => setTimeout(longestSdkTimeoutMs, undefined, { signal }));
    bound.fire();

    await expect(waiting).rejects.toMatchObject({ cause: { code: SdkErrorCode.RequestTimeout } });
  });
});

describe('a race against a bound', () => {
  it('answers what came first, the awaited value or the late one, and stops the bound', async () => {
    const recorded = recordingTimer();
    const bound = manualTimer();

    const inTime = await raceAgainst(recorded.timer, 10, Promise.resolve('opened'), 'late');
    const late = raceAgainst(bound.timer, 10, Promise.withResolvers<string>().promise, 'late');
    bound.fire();

    expect([inTime, await late]).toEqual(['opened', 'late']);
    expect(recorded.waits()).toEqual([{ ms: 10, stopped: true }]);
  });
});

describe('a pause', () => {
  it('ends when its timer runs out, when its signal aborts, or at once when the signal already has', async () => {
    const pause = manualTimer();
    const stopping = new AbortController();
    const recorded = recordingTimer();

    const timedOut = pausedFor(pause.timer, 5000);
    pause.fire();
    const stopped = pausedFor(recorded.timer, 5000, stopping.signal);
    stopping.abort();

    await expect(
      Promise.all([timedOut, stopped, pausedFor(recorded.timer, 5000, AbortSignal.abort())]),
    ).resolves.toEqual([undefined, undefined, undefined]);
    expect([pause.waits(), recorded.waits()]).toEqual([[5000], [{ ms: 5000, stopped: true }]]);
  });
});
