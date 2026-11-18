import type { Goal } from '@on.auto/definitions/goals';
import { describe, expect, it } from 'vitest';

import {
  afterSpan,
  assessmentBookOf,
  controlsGoal,
  day,
  daySpan,
  experimentsGoal,
  firstDay,
  inTurn,
  instantText,
  thingAt,
  type AssessmentBook,
} from './assessment-samples.ts';
import { goalAssessmentsIn } from './goal-assessments.ts';

const hour = 3_600_000;

const live = firstDay + day;

function indexes(length: number): readonly number[] {
  return Array.from({ length }, (_, index) => index);
}

function read(book: AssessmentBook, goal: Goal = experimentsGoal) {
  return book.inThePlaybook(goalAssessmentsIn(goal));
}

async function endedEachWay(book: AssessmentBook) {
  const passed = await thingAt(book, { per: 'MAR-41', at: firstDay, marked: ['live'], live });
  await book.observed(passed, live + day, { measurement: { value: 1, final: false, as_of: live + day } });
  await book.assessed(passed, 'passed', live + day);
  const failed = await thingAt(book, { per: 'MAR-42', at: firstDay + hour, marked: ['live'], live });
  await book.observed(failed, live + 7 * day, { measurement: { value: 0, final: true, as_of: live + 7 * day } });
  const afterTheClose = live + 7 * day + hour;
  await book.observed(failed, afterTheClose, { measurement: { value: 2, final: false, as_of: afterTheClose } });
  await book.assessed(failed, 'failed', live + 8 * day, 'final');
  const quiet = await thingAt(book, { per: 'MAR-43', at: firstDay + 2 * hour, marked: ['live'], live });
  await book.overdue(quiet, live + 8 * day);
  await book.ended(quiet, 'no_result', live + 15 * day);
  const retired = await thingAt(book, { per: 'MAR-44', at: firstDay + 3 * hour, marked: ['live'], live });
  await book.ended(retired, 'goal_retired', live + 16 * day);
  return { passed, failed, quiet };
}

describe('the ended assessments of a goal', () => {
  it('are counted by outcome and listed newest first with the number each was judged on', async () => {
    const book = assessmentBookOf();
    const { passed, failed, quiet } = await endedEachWay(book);

    const assessments = await read(book);

    expect(assessments.open_count).toBe(0);
    expect(assessments.in_flight).toEqual([]);
    expect(assessments.closed).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      no_result: 1,
      latest: [
        {
          id: quiet,
          outcome: 'no_result',
          at: instantText(live + 15 * day),
          per: { id: 'MAR-43', title: 'Experiment MAR-43' },
          window: { opens: instantText(live), closes: instantText(live + 7 * day), due: instantText(live + 8 * day) },
          rule: { settles: 'on_crossing', target: { at_least: 1 } },
          milestones: experimentsGoal.milestones,
          marks: [{ milestone: 'live', at: instantText(firstDay + 2 * hour), run: 'run-6' }],
        },
        expect.objectContaining({ id: failed, outcome: 'failed', at: instantText(live + 8 * day), value: 0 }),
        expect.objectContaining({ id: passed, outcome: 'passed', at: instantText(live + day), value: 1 }),
      ],
      last_passed: { id: passed, at: instantText(live + day) },
      misses_since: { at: instantText(live + 8 * day), count: 2 },
    });
    expect(assessments.current).toMatchObject({ id: failed, verdict: 'failed' });
  });
});

describe('the current assessment of a goal whose assessments ended', () => {
  it('is never one that ended with no result, so the overdue is only shown as closed when they ended with no result, so the overdue is only shown as closed', async () => {
    const book = assessmentBookOf();
    const quiet = await thingAt(book, { per: 'MAR-43', at: firstDay, marked: ['live'], live });
    await book.overdue(quiet, live + 8 * day);
    await book.ended(quiet, 'no_result', live + 15 * day);

    const ended = await read(book);
    const waiting = await thingAt(book, { per: 'MAR-44', at: firstDay + hour, marked: [], live });
    const opened = await read(book);

    expect(ended.current).toBeNull();
    expect(ended.closed).toMatchObject({ total: 1, no_result: 1, latest: [{ id: quiet, outcome: 'no_result' }] });
    expect(opened.current).toMatchObject({ id: waiting, verdict: 'open' });
    expect(opened.current).not.toHaveProperty('overdue_since');
  });

  it('says no overdue once a final measurement after the due has judged it', async () => {
    const book = assessmentBookOf();
    const late = await thingAt(book, { per: 'MAR-45', at: firstDay, marked: ['live'], live });
    await book.overdue(late, live + 8 * day);
    await book.observed(late, live + 9 * day, { measurement: { value: 1, final: true, as_of: live + 7 * day } });
    await book.assessed(late, 'passed', live + 9 * day, 'final');

    const { current, closed } = await read(book);

    expect(current).toMatchObject({ id: late, verdict: 'passed', verdict_at: instantText(live + 9 * day) });
    expect(current).not.toHaveProperty('overdue_since');
    expect(closed).toMatchObject({ total: 1, passed: 1, latest: [{ id: late, outcome: 'passed' }] });
  });
});

describe('the latest ended assessments of a goal', () => {
  it('are listed sixty at most, past any that ended because the goal was retired', async () => {
    const book = assessmentBookOf();
    const passed = await inTurn(indexes(62), async (index) => {
      const id = await thingAt(book, {
        per: `MAR-${String(index)}`,
        at: firstDay + index * hour,
        marked: ['live'],
        live,
      });
      await book.assessed(id, 'passed', live + day + index * hour);
      return id;
    });
    await inTurn(indexes(65), async (index) => {
      const id = await thingAt(book, {
        per: `OLD-${String(index)}`,
        at: firstDay + index * hour,
        marked: ['live'],
        live,
      });
      await book.ended(id, 'goal_retired', live + 3 * day + index * hour);
    });

    const { closed } = await read(book);

    expect(closed.total).toBe(62);
    expect(closed.latest.map(({ id }) => id)).toEqual(passed.toReversed().slice(0, 60));
  });
});

describe('the assessments of a goal with nothing judged', () => {
  it('are none, with each milestone counted as none, where nothing was judged', async () => {
    expect(await read(assessmentBookOf())).toEqual({
      current: null,
      open_count: 0,
      stopped_count: 0,
      dismissed_count: 0,
      in_flight: [],
      by_milestone: { chosen: 0, prepared: 0, live: 0, measured: 0 },
      waiting: { chosen: 0, prepared: 0, live: 0, measured: 0 },
      closed: { total: 0, passed: 0, failed: 0, no_result: 0, latest: [] },
    });
  });
});

async function controlDays(book: AssessmentBook) {
  const monday = await book.opened(controlsGoal, firstDay, { window: daySpan(firstDay) });
  await book.observed(monday, firstDay + 9 * hour, {
    measurement: { value: 0, final: true, as_of: firstDay + 9 * hour },
  });
  await book.assessed(monday, 'passed', firstDay + day + hour, 'final');
  await book.opened(controlsGoal, firstDay + day, { window: daySpan(firstDay + day) });
  const wednesday = await book.opened(controlsGoal, firstDay + 2 * day, { window: daySpan(firstDay + 2 * day) });
  const alert = firstDay + 2 * day + 14 * hour;
  await book.observed(wednesday, alert, { measurement: { value: 1, final: false, as_of: alert } });
  await book.assessed(wednesday, 'failed', alert);
  const thursday = await book.opened(controlsGoal, firstDay + 3 * day, { window: daySpan(firstDay + 3 * day) });
  return { wednesday, thursday };
}

describe('the current assessment of a goal judged day by day', () => {
  it('is the open day with evidence, else the newest day that ended', async () => {
    const book = assessmentBookOf();
    const { wednesday, thursday } = await controlDays(book);

    const before = await read(book, controlsGoal);
    const check = firstDay + 3 * day + 9 * hour;
    await book.observed(thursday, check, { measurement: { value: 0, final: false, as_of: check } });
    const after = await read(book, controlsGoal);

    expect(before.current?.id).toBe(wednesday);
    expect([before.by_milestone, before.waiting]).toEqual([{}, {}]);
    expect(before.closed.latest.map(({ outcome, value }) => [outcome, value])).toEqual([
      ['failed', 1],
      ['passed', 0],
    ]);
    expect(after.current).toMatchObject({
      id: thursday,
      verdict: 'open',
      window: { opens: instantText(firstDay + 3 * day) },
    });
    expect(after.open_count).toBe(2);
  });

  it('is the newest open day when none has evidence and none ended', async () => {
    const book = assessmentBookOf();
    await book.opened(controlsGoal, firstDay, { window: daySpan(firstDay) });
    const tuesday = await book.opened(controlsGoal, firstDay + day, { window: daySpan(firstDay + day) });

    expect((await read(book, controlsGoal)).current?.id).toBe(tuesday);
  });
});

describe('the number an ended assessment of an after window was judged on', () => {
  it('is the crossing measured through the instant an after window opens', async () => {
    const book = assessmentBookOf();
    const opening = await thingAt(book, { per: 'MAR-45', at: firstDay, marked: ['live'], live });
    await book.observed(opening, live, { measurement: { value: 1, final: false, as_of: live } });
    await book.assessed(opening, 'passed', live);

    expect((await read(book)).closed.latest).toEqual([
      expect.objectContaining({ id: opening, outcome: 'passed', at: instantText(live), value: 1 }),
    ]);
  });

  it('is the crossing measured by the run that opened an after window, though its as_of comes a little before', async () => {
    const book = assessmentBookOf();
    const opening = await book.opened(experimentsGoal, firstDay, { per: 'MAR-46' });
    await book.observed(opening, live, {
      marks: 'live',
      window: afterSpan(live),
      measurement: { value: 1, final: false, as_of: live - 150 },
    });
    await book.assessed(opening, 'passed', live);

    expect((await read(book)).closed.latest).toEqual([
      expect.objectContaining({ id: opening, outcome: 'passed', at: instantText(live), value: 1 }),
    ]);
  });
});

describe('an assessment missed by its deadline', () => {
  it('ends failed, judged by its deadline, with no number, though a late measurement came in', async () => {
    const book = assessmentBookOf();
    const monday = await book.opened(controlsGoal, firstDay, { window: daySpan(firstDay) });
    const { due } = daySpan(firstDay);
    await book.overdue(monday, due);
    await book.observed(monday, due + hour, { measurement: { value: 3, final: true, as_of: due + hour } });
    await book.assessed(monday, 'failed', due, 'deadline');

    const goal = await read(book, controlsGoal);

    expect(goal.closed).toMatchObject({ total: 1, failed: 1, no_result: 0 });
    expect(goal.closed.latest).toEqual([
      {
        id: monday,
        outcome: 'failed',
        at: instantText(due),
        window: {
          opens: instantText(firstDay),
          closes: instantText(firstDay + day),
          due: instantText(due),
        },
        by: 'deadline',
        rule: { settles: 'on_crossing', target: { at_most: 0 } },
        milestones: [],
        marks: [],
        measurement: {
          value: 3,
          final: true,
          as_of: instantText(due + hour),
          at: instantText(due + hour),
          run: 'run-1',
        },
      },
    ]);
    expect(goal.current).toMatchObject({ id: monday, verdict: 'failed', verdict_by: 'deadline' });
    expect(goal.current?.overdue_since).toBeUndefined();
  });
});
