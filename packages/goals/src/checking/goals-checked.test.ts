import { internalTermsIn } from '@on.auto/operations/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsCheckedOf, type WindowTiming } from '../index.ts';
import { comesRoundTooOften, summaryTimesChecked } from './goal-timings.ts';

const at = Date.UTC(2026, 10, 9, 12);

const naming = { name: 'Growth', description: 'Experiments that bring customers' };

const experiments = {
  id: 'paying-customers',
  statement: 'Bring in paying customers through my experiments.',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: {
    label: 'New paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Brought a customer',
    failed: 'Brought no customer',
  },
  milestones: [
    { id: 'chosen', label: 'Idea chosen', by: 'person' },
    { id: 'live', label: 'Taken live', by: 'person' },
    { id: 'measured', label: 'Measured', by: 'auto' },
  ],
  notify: {
    passed: 'now',
    failed: 'now',
    overdue: 'now',
    through: 'tell-owner',
    summary: { cron: '0 9 * * 5', time_zone: 'America/Los_Angeles', through: 'weekly-note' },
  },
};

const controls = {
  id: 'controls-hold',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day', time_zone: 'Europe/Berlin', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'Held',
    failed: 'Broke',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

function withWindow(goal: object, window: object) {
  return { ...goal, window };
}

function withSummary(summary: object) {
  return { ...experiments, notify: { ...experiments.notify, summary } };
}

interface Seen {
  readonly pointer: string;
  readonly detail: string;
}

function issuesOf(...goals: readonly object[]): readonly Seen[] {
  return Result.match(goalsCheckedOf(JSON.stringify(goals), naming, at), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map(({ pointer, detail }) => ({ pointer, detail })),
  });
}

describe('the full check of goals', () => {
  it('takes goals whose durations, time zones and summary hold', () => {
    expect(Result.isSuccess(goalsCheckedOf(JSON.stringify([experiments, controls]), naming, at))).toBe(true);
  });

  it('takes durations from a minute to 90 days, and a summary that comes exactly once an hour', () => {
    expect(issuesOf(withWindow(experiments, { after: 'live', for: 'P90D', grace: 'PT1M' }))).toEqual([]);
    expect(issuesOf(withSummary({ cron: '0 * * * *' }))).toEqual([]);
  });
});

describe('the durations of goals', () => {
  it('refuses a length that is not exact or lies outside a minute to 90 days', () => {
    expect(issuesOf(withWindow(experiments, { after: 'live', for: 'P1M', grace: 'PT0M' }))).toEqual([
      {
        pointer: '/0/window/for',
        detail:
          'How long the goal paying-customers runs is no exact length: write weeks, days, hours and minutes, such as P7D or PT12H',
      },
      {
        pointer: '/0/window/grace',
        detail: 'The grace of the goal paying-customers lasts from a minute to 90 days, not PT0M',
      },
    ]);
    expect(issuesOf(withWindow(controls, { calendar: 'week', grace: 'P13W' }))).toEqual([
      {
        pointer: '/0/window/grace',
        detail: 'The grace of the goal controls-hold lasts from a minute to 90 days, not P13W',
      },
    ]);
  });
});

describe('the time zones and summaries of goals', () => {
  it('refuses a time zone name the runtime does not know, in a window or a summary', () => {
    expect(issuesOf(withWindow(controls, { calendar: 'day', time_zone: 'Nowhere/Nothing' }))).toEqual([
      {
        pointer: '/0/window/time_zone',
        detail:
          'The time zone of the goal controls-hold is no time zone name this runtime knows; name one from the time zone database, or leave it out for UTC',
      },
    ]);
    expect(issuesOf(withSummary({ cron: '0 9 * * 5', time_zone: '+02:00' }))).toMatchObject([
      { pointer: '/0/notify/summary/time_zone' },
    ]);
  });

  it('refuses a summary schedule that is no cron expression or names no time that comes', () => {
    expect(
      issuesOf(withSummary({ cron: 'every friday' }), { ...withSummary({ cron: '0 0 30 2 *' }), id: 'second-goal' }),
    ).toEqual([
      {
        pointer: '/0/notify/summary/cron',
        detail:
          'The summary of the goal paying-customers has a schedule that is not a valid cron expression: five fields, minute, hour, day of month, month and day of week',
      },
      {
        pointer: '/1/notify/summary/cron',
        detail:
          'The summary of the goal second-goal has a schedule that is not a valid cron expression: five fields, minute, hour, day of month, month and day of week',
      },
    ]);
  });

  it('refuses a summary that would come more often than once an hour over its next times', () => {
    const tooOften = {
      pointer: '/0/notify/summary/cron',
      detail:
        'The summary of the goal paying-customers would come more often than once an hour; give it times an hour or more apart',
    };

    expect(issuesOf(withSummary({ cron: '* * * * *' }))).toEqual([tooOften]);
    expect(issuesOf(withSummary({ cron: '0,30 9 * * 1' }))).toEqual([tooOften]);
    expect(issuesOf(withSummary({ cron: '0,59 9,10 1 * *' }))).toEqual([tooOften]);
  });
});

describe('the words of the full check of goals', () => {
  it("refuses a statement that only repeats the playbook's name or description, ignoring case, spaces and punctuation", () => {
    expect(issuesOf({ ...experiments, statement: 'experiments, that bring CUSTOMERS!' })).toEqual([
      {
        pointer: '/0/statement',
        detail:
          "Ask the person: What change do you want from this? The statement of the goal paying-customers only repeats the playbook's name or description.",
      },
    ]);
  });

  it('says each problem in at most 256 bytes, with none of the internal terms', () => {
    const details = issuesOf(
      withWindow(experiments, { after: 'live', for: 'P1D/P2D', grace: 'P91D' }),
      withWindow({ ...controls, id: 'controls-two' }, { calendar: 'day', time_zone: 'Nowhere' }),
      { ...withSummary({ cron: 'soon' }), id: 'third-goal' },
      { ...withSummary({ cron: '* * * * *', time_zone: 'UTC' }), id: 'fourth-goal' },
    ).map(({ detail }) => detail);

    expect(details).toHaveLength(5);
    expect(details.filter((detail) => new TextEncoder().encode(detail).length > 256)).toEqual([]);
    expect(details.flatMap((detail) => internalTermsIn(detail))).toEqual([]);
  });
});

describe('how often a schedule comes round', () => {
  it(`looks at its next ${String(summaryTimesChecked)} times from the moment given`, () => {
    const lateInTheMonth: WindowTiming = { kind: 'cron', expression: '0,30 9 1 * *' };

    expect(comesRoundTooOften(lateInTheMonth, at)).toBe(true);
    expect(comesRoundTooOften({ kind: 'cron', expression: '0 9 * * *' }, at)).toBe(false);
  });

  it('counts the 25th time and not the 26th, as a clock change brings two times half an hour apart', () => {
    const atEveryQuarterToTheHour: WindowTiming = {
      kind: 'cron',
      expression: '45 * * * *',
      time_zone: 'Australia/Lord_Howe',
    };

    expect(comesRoundTooOften(atEveryQuarterToTheHour, Date.UTC(2026, 9, 2, 16))).toBe(true);
    expect(comesRoundTooOften(atEveryQuarterToTheHour, Date.UTC(2026, 9, 2, 15))).toBe(false);
  });

  it('finds nothing too often in a schedule with no time to come, or one that cannot be read', () => {
    expect(comesRoundTooOften({ kind: 'cron', expression: '0 0 30 2 *' }, at)).toBe(false);
    expect(comesRoundTooOften({ kind: 'cron', expression: '* * * * *', time_zone: 'Nowhere/Nothing' }, at)).toBe(false);
  });
});
