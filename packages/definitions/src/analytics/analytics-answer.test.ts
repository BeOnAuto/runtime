import type { RunOutcomeGroup } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { analyticsOf, durationOf, type PlaybookAnalytics } from './analytics-answer.ts';

function group(overrides: Partial<RunOutcomeGroup>): RunOutcomeGroup {
  return {
    day: '2026-10-01',
    definitionType: 'reasoning',
    name: 'triage',
    status: 'succeeded',
    runs: 1,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durations: [],
    ...overrides,
  };
}

const window = { from: '2026-09-30', to: '2026-10-02', days: 3 };

function functionsOf({ by_function: functions }: PlaybookAnalytics): readonly string[] {
  return functions.map(({ type, name }) => `${type} ${name}`);
}

const noRuns = { total: 0, succeeded: 0, failed: 0, rejected: 0 };

const noTokens = { input: 0, output: 0, cached: 0 };

describe('a percentile of the durations of runs', () => {
  it('is the nearest rank, the value at the place p × n rounded up of the durations in order', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => (20 - index) * 10);

    expect([
      durationOf([]),
      durationOf([42]),
      durationOf([300, 100, 200]),
      durationOf([4, 1, 3, 2]),
      durationOf(twenty),
      durationOf([...twenty, 1000]),
    ]).toEqual([
      null,
      { p50: 42, p95: 42 },
      { p50: 200, p95: 300 },
      { p50: 2, p95: 4 },
      { p50: 100, p95: 190 },
      { p50: 110, p95: 200 },
    ]);
  });
});

describe('the analytics of a playbook', () => {
  it('count the runs that ended and the tokens they used, by day and by function, leaving out runs still going', () => {
    const groups = [
      group({ runs: 2, inputTokens: 100, outputTokens: 40, cachedTokens: 60, durations: [300, 100] }),
      group({ status: 'rejected', inputTokens: 10, outputTokens: 2, cachedTokens: 0 }),
      group({ day: '2026-10-02', definitionType: 'workflow', name: 'approval', durations: [5000] }),
      group({ day: '2026-10-02', status: 'failed', durations: [200] }),
      group({ day: '2026-10-02', status: 'started', runs: 4, durations: [] }),
      group({ day: '2026-10-02', name: 'draft', status: 'started' }),
    ];

    expect(analyticsOf(window, groups)).toEqual({
      days: 3,
      runs: { total: 5, succeeded: 3, failed: 1, rejected: 1 },
      tokens: { input: 110, output: 42, cached: 60 },
      duration_ms: { p50: 200, p95: 5000 },
      by_day: [
        { day: '2026-09-30', runs: noRuns, tokens: noTokens, duration_ms: null },
        {
          day: '2026-10-01',
          runs: { total: 3, succeeded: 2, failed: 0, rejected: 1 },
          tokens: { input: 110, output: 42, cached: 60 },
          duration_ms: { p50: 100, p95: 300 },
        },
        {
          day: '2026-10-02',
          runs: { total: 2, succeeded: 1, failed: 1, rejected: 0 },
          tokens: noTokens,
          duration_ms: { p50: 200, p95: 5000 },
        },
      ],
      by_function: [
        { type: 'reasoning', name: 'triage', runs: 4 },
        { type: 'workflow', name: 'approval', runs: 1 },
      ],
    });
  });
});

describe('the functions in the analytics of a playbook', () => {
  it('are ordered by their runs, the most first, then by type and name in the order of their characters', () => {
    const groups = [
      group({ definitionType: 'workflow', name: 'b' }),
      group({ definitionType: 'reasoning', name: 'b-2' }),
      group({ definitionType: 'reasoning', name: 'b' }),
      group({ definitionType: 'reasoning', name: 'a', status: 'failed' }),
      group({ definitionType: 'workflow', name: 'a', runs: 3 }),
    ];

    const ordered = ['workflow a', 'reasoning a', 'reasoning b', 'reasoning b-2', 'workflow b'];

    const givenOrders: readonly (readonly RunOutcomeGroup[])[] = [groups, groups.toReversed()];

    expect(givenOrders.map((given) => functionsOf(analyticsOf(window, given)))).toEqual([ordered, ordered]);
  });
});

describe('the analytics of a playbook whose runs are all still going', () => {
  it('answer every day with nothing, and no duration', () => {
    expect(analyticsOf(window, [group({ status: 'started' })])).toMatchObject({
      runs: noRuns,
      tokens: noTokens,
      duration_ms: null,
      by_function: [],
    });
  });
});
