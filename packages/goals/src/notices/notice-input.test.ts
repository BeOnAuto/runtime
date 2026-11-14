import type { Goal } from '@on.auto/definitions/goals';
import { describe, expect, it } from 'vitest';

import { unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { noticeInputOf } from './notice-input.ts';
import { monday, owner } from './notice-samples.ts';

const controls: Goal = {
  id: 'controls-hold',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'All controls held',
    failed: 'A control failed',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

const day = { opens: monday, closes: monday + 86_400_000, due: monday + 90_000_000 };

const measured: AssessmentState = {
  ...unopened,
  pinned: { goal: controls.id, goalsVersion: 1, settles: 'on_crossing', target: { at_most: 0 }, milestones: [] },
  window: day,
  measurement: { value: 2, final: false, as_of: monday, at: monday, run: 'r-1' },
};

describe('the input of a notice', () => {
  it('says the failed word, the statement and the measure when nothing was said', () => {
    expect(noticeInputOf({ goal: controls, state: measured, change: 'failed', owner })).toEqual({
      change: 'failed',
      headline: 'A control failed: Every control passes its daily check.',
      detail: 'Failing controls: 2',
      owner,
      goal: { id: controls.id, statement: controls.statement },
      window: { opens: '2026-11-09T09:00:00.000Z', closes: '2026-11-10T09:00:00.000Z' },
      measure: { label: 'Failing controls', value: 2, target: 0 },
    });
  });
});

describe('the input of a notice of a deadline missed', () => {
  it('says the failed word and no number when the deadline passed with nothing that counts', () => {
    const missed: AssessmentState = { ...measured, verdict: 'failed', verdictAt: day.due, verdictBy: 'deadline' };

    expect(noticeInputOf({ goal: controls, state: missed, change: 'failed', owner })).toEqual({
      change: 'failed',
      headline: 'A control failed: Every control passes its daily check.',
      owner,
      goal: { id: controls.id, statement: controls.statement },
      window: { opens: '2026-11-09T09:00:00.000Z', closes: '2026-11-10T09:00:00.000Z' },
    });
  });
});

describe('the input of a notice with evidence', () => {
  it('leads with what the evidence said, and names the thing it is about with its title and link', () => {
    const thing: AssessmentState = {
      ...measured,
      pinned: {
        ...measured.pinned,
        goal: controls.id,
        goalsVersion: 1,
        settles: 'on_crossing',
        target: { at_least: 1 },
        milestones: [],
        per: 'vendor-3',
      },
      title: 'Vendor three',
      link: 'https://example.com/vendors/3',
      measurement: { value: 1, final: true, as_of: monday, at: monday, run: 'r-2', says: 'One control was missed.' },
    };

    expect(noticeInputOf({ goal: controls, state: thing, change: 'passed', owner })).toMatchObject({
      headline: 'All controls held: Vendor three',
      detail: 'One control was missed.',
      says: 'One control was missed.',
      per: { id: 'vendor-3', title: 'Vendor three', link: 'https://example.com/vendors/3' },
      measure: { target: 1 },
    });
  });
});

describe('the input of a notice of a verdict the final measurement settled', () => {
  it('says the final value that settled it, not a later count that was not final, nor what that count said', () => {
    const settled: AssessmentState = {
      ...measured,
      measurement: {
        value: 3,
        final: false,
        as_of: day.closes + 1,
        at: day.due,
        run: 'r-poll',
        says: 'Three are failing now.',
      },
      finalMeasurement: { value: 0, as_of: day.closes, at: day.closes, run: 'r-final' },
      verdict: 'passed',
      verdictAt: day.due,
    };
    const sameRun: AssessmentState = {
      ...settled,
      measurement: { value: 0, final: true, as_of: day.closes, at: day.closes, run: 'r-final', says: 'None failed.' },
    };
    const ofIt = (state: AssessmentState) => noticeInputOf({ goal: controls, state, change: 'passed', owner });

    expect([ofIt(settled).detail, ofIt(settled).measure?.value, ofIt(settled).says]).toEqual([
      'Failing controls: 0',
      0,
      undefined,
    ]);
    expect([ofIt(sameRun).detail, ofIt(sameRun).says]).toEqual(['None failed.', 'None failed.']);
    expect(noticeInputOf({ goal: controls, state: settled, change: 'overdue', owner }).measure?.value).toBe(3);
  });

  it('says the standing value of a verdict a crossing settled before the due', () => {
    const crossed: AssessmentState = {
      ...measured,
      finalMeasurement: { value: 0, as_of: monday, at: monday, run: 'r-0' },
      verdict: 'failed',
      verdictAt: monday + 1,
    };

    expect(noticeInputOf({ goal: controls, state: crossed, change: 'failed', owner }).measure?.value).toBe(2);
  });
});

describe('the input of a notice with little to say', () => {
  it('says no result yet for an overdue, with what a milestone said when nothing was measured', () => {
    const quiet: AssessmentState = {
      ...unopened,
      marks: [
        { milestone: 'a', at: monday, run: 'r-1', says: 'Started' },
        { milestone: 'b', at: monday, run: 'r-2' },
      ],
    };

    expect(noticeInputOf({ goal: controls, state: quiet, change: 'overdue', owner })).toEqual({
      change: 'overdue',
      headline: 'No result yet: Every control passes its daily check.',
      detail: 'Started',
      says: 'Started',
      owner,
      goal: { id: controls.id, statement: controls.statement },
    });
  });

  it('carries no detail when nothing was measured or said, and takes the live target of an unpinned state', () => {
    const bare = noticeInputOf({ goal: controls, state: unopened, change: 'passed', owner });
    const unpinned = noticeInputOf({
      goal: controls,
      state: { ...unopened, measurement: { value: 0, final: true, as_of: monday, at: monday, run: 'r-3' } },
      change: 'passed',
      owner,
    });

    expect([bare.detail, unpinned.measure]).toEqual([undefined, { label: 'Failing controls', value: 0, target: 0 }]);
  });
});

const checks: Goal = {
  ...controls,
  id: 'checks-pass',
  statement: 'Every check run passes all of its checks.',
  per: 'check run',
  window: { after: 'started', for: 'PT3M', grace: 'PT1M' },
};
const opens = monday + 81_000;
const early: AssessmentState = {
  ...unopened,
  pinned: {
    goal: checks.id,
    goalsVersion: 1,
    per: 'run-1',
    settles: 'on_crossing',
    target: { at_most: 0 },
    window: { after: 'started', for: 'PT3M', grace: 'PT1M' },
    milestones: [{ id: 'started', label: 'Started', by: 'auto' }],
  },
  title: 'Check run 1',
  window: { opens, closes: opens + 180_000, due: opens + 240_000 },
  marks: [{ milestone: 'started', at: opens, run: 'r-2' }],
  measurement: {
    value: 0,
    final: true,
    as_of: monday + 20_000,
    at: opens + 60_000,
    run: 'r-3',
    says: 'All checks passed.',
  },
};

describe('the input of an overdue notice whose standing measurement does not count in the window', () => {
  it('leaves out what that measurement said and its value', () => {
    expect(noticeInputOf({ goal: checks, state: early, change: 'overdue', owner })).toEqual({
      change: 'overdue',
      headline: 'No result yet: Check run 1',
      owner,
      goal: { id: checks.id, statement: checks.statement },
      per: { id: 'run-1', title: 'Check run 1' },
      window: { opens: new Date(opens).toISOString(), closes: new Date(opens + 180_000).toISOString() },
    });
  });

  it('keeps what a measurement that counts in the window said', () => {
    const counted: AssessmentState = {
      ...early,
      measurement: {
        value: 0,
        final: false,
        as_of: opens + 1,
        at: opens + 60_000,
        run: 'r-3',
        says: 'Five of 14 reported.',
      },
    };

    expect(noticeInputOf({ goal: checks, state: counted, change: 'overdue', owner })).toMatchObject({
      detail: 'Five of 14 reported.',
      measure: { value: 0 },
    });
  });
});
