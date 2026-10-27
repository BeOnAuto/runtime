import { describe, expect, it } from 'vitest';

import type { LicensePollResult, ReportPollResult } from '../index.ts';
import { maintainSelfHosted } from './maintenance.ts';

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('owned maintenance work', () => {
  it('waits for a report still using storage before returning an unexpected license error', async () => {
    const failure = new Error('invalid_clock_sample');
    const report = Promise.withResolvers<ReportPollResult>();
    const state = { finished: false };
    const running = maintainSelfHosted(
      () => Promise.reject(failure),
      () => report.promise,
    );
    const observed = running.catch(() => {
      state.finished = true;
    });
    await nextTurn();
    expect(state.finished).toBe(false);
    report.resolve({ status: 'reported', retryInMilliseconds: 300_000 });
    await expect(running).rejects.toBe(failure);
    await observed;
    expect(state.finished).toBe(true);
  });

  it('joins license persistence before returning a synchronous report polling failure', async () => {
    const failure = new Error('invalid_monotonic_time');
    const license = Promise.withResolvers<LicensePollResult>();
    const state = { finished: false };
    const running = maintainSelfHosted(
      () => license.promise,
      () => {
        throw failure;
      },
    );
    const observed = running.catch(() => {
      state.finished = true;
    });
    await nextTurn();
    expect(state.finished).toBe(false);
    license.resolve({ status: 'refreshed', retryInMilliseconds: 60_000 });
    await expect(running).rejects.toBe(failure);
    await observed;
    expect(state.finished).toBe(true);
  });
});
