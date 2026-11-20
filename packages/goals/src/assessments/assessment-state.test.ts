import { describe, expect, it } from 'vitest';

import type { GoalRule } from '../goal-rules/goal-rule.ts';
import type { Observation } from '../observations/observation.ts';
import type { AssessmentFact } from './assessment-facts.ts';
import { assessmentAfter, assessmentOf, unopened, type AssessmentState } from './assessment-state.ts';
import { factsAtMoment } from './judging.ts';
import { factsObserving } from './observing.ts';

const hour = (offset: number) => Date.UTC(2026, 10, 9, offset);

const iso = (at: number) => new Date(at).toISOString();

const daily: GoalRule = {
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  milestones: [
    { id: 'checked', label: 'Checked', by: 'auto' },
    { id: 'reviewed', label: 'Reviewed', by: 'person' },
    { id: 'closed', label: 'Closed', by: 'person' },
  ],
  notify: { passed: 'now', failed: 'now' },
};

let records = 0;

function observed(at: number, parts: Partial<Observation> = {}): Observation {
  records += 1;
  return {
    goal: daily.id,
    source: { record: `r${records}`, run: `run${records}`, workflow: 'w', version: 1, entry: 0 },
    at,
    ...parts,
  };
}

const observe = (state: AssessmentState, now: number, ...observations: readonly Observation[]) =>
  factsObserving(state, { goal: daily, goalVersion: 1, now, observations });

const after = (state: AssessmentState, facts: readonly AssessmentFact[]) =>
  facts.reduce((before, fact) => assessmentAfter(before, fact), state);

const monday = assessmentOf(observe(unopened, hour(9), observed(hour(9), { marks: 'checked', says: 'Ran.' })));

describe('opening by an observation', () => {
  it('opens the current calendar window when the clock has not, keeping the evidence on the mark', () => {
    expect([monday.window?.due, monday.marks]).toEqual([
      hour(25),
      [{ milestone: 'checked', at: hour(9), run: 'run1', says: 'Ran.' }],
    ]);
  });

  it('opens no earlier window that was never opened', () => {
    expect(
      observe(unopened, hour(25), observed(hour(25), { measurement: { value: 0, final: true, as_of: hour(20) } })),
    ).toEqual([]);
  });

  it('opens nothing for a goal with milestones on an observation that marks none of them', () => {
    const whole = { ...daily, window: undefined };
    const { window: _, ...noWindow } = whole;

    expect(
      factsObserving(unopened, {
        goal: noWindow,
        goalVersion: 1,
        now: 0,
        observations: [observed(0, { marks: 'other' })],
      }),
    ).toEqual([]);
  });

  it('takes nothing once the assessment has ended', () => {
    const ended = after(monday, [{ type: 'goal_assessment_ended', data: { reason: 'no_result' } }]);

    expect(observe(ended, hour(10), observed(hour(10), { marks: 'reviewed' }))).toEqual([]);
  });
});

describe('opening by a run delivered late', () => {
  it('opens the window that holds the run end, however late the run is delivered', () => {
    const lastSeconds = hour(24) - 10_000;
    const late = (now: number) =>
      observe(unopened, now, observed(lastSeconds, { measurement: { value: 0, final: true, as_of: lastSeconds } }));

    const onTime = late(lastSeconds + 1_000);
    const nextDay = late(hour(24) + 10_000);

    expect(nextDay.map(({ type }) => type)).toEqual(['goal_assessment_opened', 'goal_observed']);
    expect(nextDay[0]).toEqual(onTime[0]);
  });

  it('opens the window a run measures through its close, and judges it at once when its due has passed', () => {
    const facts = observe(
      unopened,
      hour(50),
      observed(hour(24), { measurement: { value: 0, final: true, as_of: hour(24) } }),
    );

    expect(facts.map(({ type }) => type)).toEqual(['goal_assessment_opened', 'goal_observed', 'goal_assessed']);
    expect(assessmentOf(facts)).toMatchObject({ window: { closes: hour(24), due: hour(25) }, verdictAt: hour(25) });
  });
});

describe('a window after a milestone the goal does not list', () => {
  it('never starts', () => {
    const odd: GoalRule = { ...daily, window: { after: 'unlisted', for: 'P1D' } };

    expect(
      factsObserving(unopened, {
        goal: odd,
        goalVersion: 1,
        now: 0,
        observations: [observed(0, { marks: 'checked' }), observed(0, { marks: 'unlisted' })],
      }).map(({ data }) => 'window' in data),
    ).toEqual([false, false]);
  });
});

describe('an observation that changes little', () => {
  it('records a new title alone, and nothing for the same title again', () => {
    const retitling = observed(hour(10), { title: 'Mon', link: 'https://example.com/m' });
    const retitled = observe(monday, hour(10), retitling);
    const titled = after(monday, retitled);

    expect(retitled.map(({ data }) => data)).toEqual([
      {
        source: retitling.source,
        at: iso(hour(10)),
        title: 'Mon',
        link: 'https://example.com/m',
      },
    ]);
    expect(observe(titled, hour(11), observed(hour(11), { title: 'Mon', link: 'https://example.com/m' }))).toEqual([]);
    expect(observe(titled, hour(11), observed(hour(11), { link: 'https://example.com/n' }))).toHaveLength(1);
  });

  it('ignores a mark of a milestone the assessment does not pin, or one already marked', () => {
    expect(
      observe(monday, hour(10), observed(hour(10), { marks: 'unknown' }), observed(hour(10), { marks: 'checked' })),
    ).toEqual([]);
  });

  it('keeps the first measurement standing on a tie of as_of', () => {
    const measuredOnce = after(
      monday,
      observe(monday, hour(10), observed(hour(10), { measurement: { value: 0, final: false, as_of: hour(10) } })),
    );

    expect(
      observe(measuredOnce, hour(11), observed(hour(11), { measurement: { value: 0, final: false, as_of: hour(10) } })),
    ).toEqual([]);
  });

  it('applies the observations of one record in turn, once', () => {
    const one = observed(hour(10), { marks: 'reviewed' });
    const two = { ...observed(hour(10), { marks: 'closed' }), source: one.source };
    const facts = observe(monday, hour(10), one, two);

    expect(facts.map(({ type }) => type)).toEqual(['goal_observed', 'goal_observed']);
    expect(observe(after(monday, facts), hour(12), two)).toEqual([]);
  });
});

describe('a verdict from an observation after the due', () => {
  it('is at the due when the run ended before it and was delivered late', () => {
    const overdue = after(monday, factsAtMoment(monday, { goal: daily, now: hour(26), playbookRetired: false }));
    const [, verdict] = observe(
      overdue,
      hour(27),
      observed(hour(23), { measurement: { value: 0, final: true, as_of: hour(23) } }),
    );

    expect(overdue.overdueSince).toBe(hour(25));
    expect(verdict?.data).toEqual(expect.objectContaining({ verdict: 'passed', by: 'final', at: iso(hour(25)) }));
  });

  it('tells an overdue the owner asked nothing about quietly', () => {
    expect(factsAtMoment(monday, { goal: daily, now: hour(25), playbookRetired: false })).toEqual([
      { type: 'goal_overdue', data: { since: iso(hour(25)), told: 'quiet' } },
    ]);
  });

  it('marks overdue and fails by its deadline at once when the clock comes back after the overdue end', () => {
    expect(
      factsAtMoment(monday, { goal: daily, now: hour(60), playbookRetired: false }).map(({ type }) => type),
    ).toEqual(['goal_overdue', 'goal_assessed']);
  });
});

const whole: GoalRule = {
  id: 'reach-a-thousand',
  success: { settles: 'on_crossing', target: { at_least: 1000 } },
  notify: { passed: 'now', failed: 'now' },
};

interface Reported {
  readonly at: number;
  readonly value: number;
  readonly final?: boolean;
}

const reported = (goal: GoalRule, state: AssessmentState, { at, value, final = false }: Reported) =>
  after(
    state,
    factsObserving(state, {
      goal,
      goalVersion: 1,
      now: at,
      observations: [observed(at, { measurement: { value, final, as_of: at } })],
    }),
  );

const observedCount = (state: AssessmentState, at: number) =>
  factsObserving(state, {
    goal: whole,
    goalVersion: 1,
    now: at,
    observations: [observed(at, { measurement: { value: 12, final: false, as_of: at } })],
  });

describe('a measurement reported again with the same number', () => {
  it('adds one fact for a thousand runs of a goal with no window', () => {
    const facts = Array.from({ length: 1000 }, (_, index) => hour(9) + index * 60_000).reduce<{
      readonly state: AssessmentState;
      readonly count: number;
    }>(
      ({ state, count }, at) => {
        const step = observedCount(state, at);
        return { state: after(state, step), count: count + step.filter(({ type }) => type === 'goal_observed').length };
      },
      { state: unopened, count: 0 },
    );

    expect(facts.count).toBe(1);
  });

  it('still counts when it is final where the standing one was not, or the number differs', () => {
    const first = reported(whole, unopened, { at: hour(9), value: 12 });

    expect(reported(whole, first, { at: hour(10), value: 12, final: true }).measurement).toMatchObject({
      final: true,
      as_of: hour(10),
    });
    expect(reported(whole, first, { at: hour(10), value: 13 }).measurement).toMatchObject({ value: 13 });
  });
});

const live: GoalRule = {
  ...whole,
  window: { after: 'live', for: 'P1D' },
  success: { settles: 'at_close', target: { at_least: 1 } },
  milestones: [
    { id: 'chosen', label: 'Chosen', by: 'person' },
    { id: 'live', label: 'Live', by: 'person' },
  ],
};

describe('a number reported again once an after window opens', () => {
  it('counts in the window though the standing one, measured before it opened, had the same number', () => {
    const marked = after(
      unopened,
      factsObserving(unopened, {
        goal: live,
        goalVersion: 1,
        now: hour(8),
        observations: [observed(hour(8), { marks: 'chosen', measurement: { value: 3, final: true, as_of: hour(8) } })],
      }),
    );
    const opened = after(
      marked,
      factsObserving(marked, {
        goal: live,
        goalVersion: 1,
        now: hour(9),
        observations: [observed(hour(9), { marks: 'live' })],
      }),
    );
    const again = reported(live, opened, { at: hour(10), value: 3, final: true });

    expect([opened.window?.opens, opened.finalMeasurement, again.finalMeasurement?.as_of]).toEqual([
      hour(9),
      undefined,
      hour(10),
    ]);
  });
});

describe('a number reported again after its window closed', () => {
  it('appends nothing when it is not final and repeats the standing number, in a calendar window too', () => {
    const atClose: GoalRule = { ...daily, success: { settles: 'at_close', target: { at_least: 1 } } };
    const counted = reported(atClose, unopened, { at: hour(9), value: 0, final: true });
    const polled = [0, 0, 1].map((value, index) => reported(atClose, counted, { at: hour(25 + index), value }));

    expect([counted.window?.closes, counted.measurement?.final, counted.verdict]).toEqual([hour(24), true, 'open']);
    expect(polled.map((state) => state === counted)).toEqual([true, true, false]);
  });
});
