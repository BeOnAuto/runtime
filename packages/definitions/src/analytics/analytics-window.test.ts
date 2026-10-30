import { InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { daysOf, windowOf, type WindowRequest } from './analytics-window.ts';

const today = '2026-10-06';

function windowFor(request: WindowRequest) {
  return Effect.runSync(Effect.result(windowOf(request, today)));
}

function refusal(pointer: string, detail: string): Result.Result<never, InvalidInput> {
  return Result.fail(
    new InvalidInput({
      detail: 'The days asked for are not a window this playbook can answer',
      issues: [{ pointer, detail }],
    }),
  );
}

describe('the window of days of the analytics of a playbook', () => {
  it('is the last 7, 14 or 30 days ending today, 7 when nothing is asked for', () => {
    expect([windowFor({}), windowFor({ days: 7 }), windowFor({ days: 14 }), windowFor({ days: 30 })]).toEqual([
      Result.succeed({ from: '2026-09-30', to: today, days: 7 }),
      Result.succeed({ from: '2026-09-30', to: today, days: 7 }),
      Result.succeed({ from: '2026-09-23', to: today, days: 14 }),
      Result.succeed({ from: '2026-09-07', to: today, days: 30 }),
    ]);
  });

  it('is the days from one day to another, both included, up to 366 of them ending today at the latest', () => {
    expect([
      windowFor({ from: '2026-10-06', to: '2026-10-06' }),
      windowFor({ from: '2026-02-27', to: '2026-03-02' }),
      windowFor({ from: '2025-10-06', to: '2026-10-06' }),
    ]).toEqual([
      Result.succeed({ from: '2026-10-06', to: '2026-10-06', days: 1 }),
      Result.succeed({ from: '2026-02-27', to: '2026-03-02', days: 4 }),
      Result.succeed({ from: '2025-10-06', to: '2026-10-06', days: 366 }),
    ]);
  });

  it('holds each of its days, oldest first, across the end of a month', () => {
    expect(daysOf({ from: '2026-02-27', to: '2026-03-02', days: 4 })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

const unanswerable: readonly (readonly [WindowRequest, string, string])[] = [
  [{ days: 7, from: '2026-10-01' }, '/days', 'Expected days, or from and to, not both'],
  [{ days: 14, to: '2026-10-01' }, '/days', 'Expected days, or from and to, not both'],
  [{ from: '2026-10-01' }, '/to', 'Expected from and to together'],
  [{ to: '2026-10-01' }, '/from', 'Expected from and to together'],
  [{ from: '2026-10-02', to: '2026-10-01' }, '/to', 'Expected a day on or after from, 2026-10-02'],
  [{ from: '2026-10-01', to: '2026-10-07' }, '/to', 'Expected a day no later than today, 2026-10-06, in UTC'],
  [{ from: '2025-10-05', to: '2026-10-06' }, '/from', 'Expected a window of at most 366 days, not 367'],
];

describe('a window of days that cannot be answered', () => {
  it.each(unanswerable)('is refused, %j', (request, pointer, detail) => {
    expect(windowFor(request)).toEqual(refusal(pointer, detail));
  });
});
