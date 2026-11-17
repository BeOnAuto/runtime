import { describe, expect, it } from 'vitest';

import type { Trigger } from '../registry/definition-triggers.ts';
import { runsADayOf } from './runs-a-day.ts';

const reference = '/schedule';

function cron(expression: string): Trigger {
  return { kind: 'cron', reference, expression };
}

function every(milliseconds: number): Trigger {
  return { kind: 'every', reference, milliseconds };
}

describe('how many times a day a workflow runs on its schedule', () => {
  it.each([
    ['* * * * *', 1440],
    ['*/5 * * * *', 288],
    ['0 * * * *', 24],
    ['0,30 9-17 * * 1-5', 18],
    ['15 9 * * *', 1],
    ['0-29/10 */2 * * *', 36],
    ['5/15 0 * * *', 4],
  ])('counts the times of the cron %s in a day', (expression, runs) => {
    expect(runsADayOf([cron(expression)])).toBe(runs);
  });

  it('counts an every schedule by its period, and adds the schedules a workflow has', () => {
    expect(runsADayOf([every(60_000)])).toBe(1440);
    expect(runsADayOf([every(3_600_000), cron('0 9 * * *')])).toBe(25);
    expect(runsADayOf([every(172_800_000)])).toBe(1);
  });

  it('knows nothing of a workflow started only by events, by hand, or by a cron it cannot read', () => {
    expect(runsADayOf()).toBeUndefined();
    expect(runsADayOf([])).toBeUndefined();
    expect(
      runsADayOf([{ kind: 'event', reference, filters: [{ reference, type: 'order.placed', attributes: {} }] }]),
    ).toBeUndefined();
    expect(runsADayOf([cron('x * * * *')])).toBeUndefined();
    expect(runsADayOf([cron('*/0 * * * *')])).toBeUndefined();
    expect(runsADayOf([cron('* *')])).toBeUndefined();
  });
});
