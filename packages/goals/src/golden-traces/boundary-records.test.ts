import { expect, it } from 'vitest';

import { noticeDueOf } from '../assessments/assessment-dues.ts';
import { assessmentIdOf, noticeRunIdOf } from '../assessments/assessment-identity.ts';
import { assessmentAfter, assessmentOf, unopened } from '../assessments/assessment-state.ts';
import { factsAtMoment } from '../assessments/judging.ts';
import { factsObserving } from '../assessments/observing.ts';
import { clockWorkAt } from '../goal-clock/goal-clock.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf } from './trace-book.ts';
import { wordsOf } from './trace-words.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const experiments: GoalRule = {
  id: 'paying-customers',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [
    { id: 'chosen', label: 'Idea chosen', by: 'person' },
    { id: 'live', label: 'Taken live', by: 'person' },
    { id: 'measured', label: 'Measured', by: 'auto' },
  ],
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

const thing = (per: string) => assessmentIdOf({ goal: 'paying-customers', per });

const markLive = { per_id: '/id', marks: 'live' };

it('applies a record delivered twice once', () => {
  const book = traceBookOf(experiments, 0);
  book.run({ at: day(0), entry: markLive, output: { id: 'A' }, record: 'record-a' });

  expect(book.run({ at: day(0), entry: markLive, output: { id: 'A' }, record: 'record-a' })).toEqual([]);
  expect(book.facts(thing('A'))).toHaveLength(2);
});

it('refuses a thing named twice in an each and opens nothing for it', () => {
  const book = traceBookOf(experiments, 0);
  const appended = book.run({
    at: day(0),
    entry: { each: '/l', ...markLive },
    output: { l: [{ id: 'A' }, { id: 'B' }, { id: 'A' }] },
  });

  expect(appended.map(({ assessment }) => assessment)).toEqual([thing('B'), thing('B')]);
  expect(book.refused().map(({ detail }) => detail)).toEqual(['/contributes/0: the thing "A" is named twice in /l']);
});

it('refuses the observations of a condition that never ends, and opens nothing', () => {
  const book = traceBookOf(experiments, 0);

  expect(book.run({ at: day(0), entry: { ...markLive, when: 'x' }, output: { id: 'A' }, when: 'not_reached' })).toEqual(
    [],
  );
  expect(book.refused()).toEqual([
    {
      goal: 'paying-customers',
      workflow: 'measure',
      run: 'run-record-1',
      detail: '/contributes/0: the condition took too long',
    },
  ]);
});

it('opens 800 assessments from one run of eight entries of 100 things, each applied once', () => {
  const book = traceBookOf(experiments, 0);
  const output = { l: Array.from({ length: 800 }, (_, index) => ({ id: `T-${index}` })) };
  for (const entry of Array.from({ length: 8 }, (_, index) => index)) {
    book.run({
      at: day(0),
      entry: { each: `/l`, ...markLive },
      output: { l: output.l.slice(entry * 100, entry * 100 + 100) },
    });
  }

  expect(book.assessments()).toHaveLength(800);
});

it('ends the open assessments of a retired goal and opens no window for it', () => {
  const book = traceBookOf(experiments, 0);
  book.run({ at: day(0), entry: markLive, output: { id: 'A' } });
  book.change({ ...experiments, retired: true });

  expect(book.ring(day(1)).map(({ fact }) => fact)).toEqual([
    { type: 'goal_assessment_ended', data: { reason: 'goal_retired' } },
  ]);
  expect(book.run({ at: day(2), entry: markLive, output: { id: 'B' } })).toEqual([]);
  expect(
    clockWorkAt({
      goal: {
        id: 'g',
        window: { calendar: 'day' },
        success: { settles: 'at_close', target: { at_most: 1 } },
        notify: { passed: 'now', failed: 'now' },
        retired: true,
      },
      goalsVersion: 1,
      now: day(0),
      firstSavedAt: 0,
      reporting: true,
      playbookRetired: false,
    }),
  ).toEqual({ nextAt: null });
});

it('keeps the verdict of a settled assessment when its goal is retired, on the clock or an observation', () => {
  const book = traceBookOf(experiments, 0);
  book.run({ at: day(0), entry: markLive, output: { id: 'A' } });
  book.run({ at: day(1), entry: { per_id: '/id', measures: '/v' }, output: { id: 'A', v: 1 } });
  const retired = { ...experiments, retired: true };
  book.change(retired);
  const settled = book.state(thing('A'));

  expect(book.ring(day(20))).toEqual([]);
  expect(factsObserving(settled, { goal: retired, goalsVersion: 2, now: day(20), observations: [] })).toEqual([]);
  expect(factsObserving(settled, { goal: undefined, goalsVersion: 2, now: day(20), observations: [] })).toEqual([]);
  expect([settled.verdict, book.state(thing('A')).ended]).toEqual(['passed', undefined]);
});

it('ends an open assessment whose goal the goals no longer hold, on an observation or the clock', () => {
  const opened = assessmentOf(
    factsObserving(unopened, {
      goal: experiments,
      goalsVersion: 1,
      now: day(0),
      observations: [
        {
          goal: 'paying-customers',
          source: { record: 'r', run: 'run', workflow: 'w', version: 1, entry: 0 },
          at: day(0),
          per: 'A',
          marks: 'live',
        },
      ],
    }),
  );
  const ended = [{ type: 'goal_assessment_ended', data: { reason: 'goal_retired' } }];

  expect(factsObserving(opened, { goal: undefined, goalsVersion: 2, now: day(1), observations: [] })).toEqual(ended);
  expect(factsAtMoment(opened, { goal: undefined, now: day(1), playbookRetired: false })).toEqual(ended);
  expect(factsObserving(unopened, { goal: undefined, goalsVersion: 2, now: day(1), observations: [] })).toEqual([]);
});

it('observes nothing for a playbook with no goals, whose clock is never due', () => {
  expect(
    clockWorkAt({
      goal: undefined,
      goalsVersion: 0,
      now: day(0),
      firstSavedAt: 0,
      reporting: true,
      playbookRetired: false,
    }),
  ).toEqual({ nextAt: null });
});

it('owes one notice of an overdue told now, under one run id however often it is started', () => {
  const book = traceBookOf({ ...experiments, notify: { passed: 'now', failed: 'now', overdue: 'now' } }, 0);
  book.run({ at: day(0), entry: markLive, output: { id: 'A' } });
  book.ring(day(8));
  const state = book.state(thing('A'));
  const run = noticeRunIdOf(thing('A'), 'overdue');
  const started = { type: 'goal_notice_started', data: { change: 'overdue', run } } as const;
  const twice = assessmentAfter(assessmentAfter(state, started), started);

  expect([noticeDueOf(state), noticeRunIdOf(thing('A'), 'overdue')]).toEqual([day(8), run]);
  expect([noticeDueOf(twice), twice.started]).toEqual([undefined, [{ change: 'overdue', run }]]);
});

it('tries a refused notice again at its retry time, and owes nothing once it is not to be tried again', () => {
  const book = traceBookOf(experiments, 0);
  book.run({ at: day(0), entry: markLive, output: { id: 'A' } });
  book.ring(day(8));
  const state = book.state(thing('A'));
  const retried = assessmentAfter(state, {
    type: 'goal_notice_refused',
    data: { change: 'overdue', attempt: 1, detail: 'unavailable', retry_at: new Date(day(8, 1)).toISOString() },
  });
  const givenUp = assessmentAfter(retried, {
    type: 'goal_notice_refused',
    data: { change: 'overdue', attempt: 2, detail: 'missing' },
  });
  const otherChange = assessmentAfter(retried, {
    type: 'goal_notice_refused',
    data: { change: 'summary', attempt: 1, detail: 'missing' },
  });

  expect([noticeDueOf(retried), retried.owed[0]?.attempt, noticeDueOf(givenUp), noticeDueOf(otherChange)]).toEqual([
    day(8, 1),
    1,
    undefined,
    day(8, 1),
  ]);
});

it('opens no window that started before the goals were first saved, as for a copy just imported', () => {
  const book = traceBookOf(
    {
      id: 'daily-check',
      window: { calendar: 'day' },
      success: { settles: 'at_close', target: { at_most: 0 } },
      notify: { passed: 'now', failed: 'now', overdue: 'now' },
    },
    day(2, 15),
  );
  const thursday = assessmentIdOf({ goal: 'daily-check', window_start: day(3) });

  expect(book.ring(day(2, 16))).toEqual([]);
  expect(book.ring(day(3)).map((appended) => wordsOf(appended, { [thursday]: 'Thursday' }))).toEqual([
    `Thursday assessment_opened due ${new Date(day(4, 1)).toISOString()}`,
  ]);
});
