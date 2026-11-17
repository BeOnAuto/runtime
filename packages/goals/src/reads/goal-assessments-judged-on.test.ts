import type { Goal } from '@on.auto/definitions/goals';
import { describe, expect, it } from 'vitest';

import {
  assessmentBookOf,
  costGoal,
  day,
  experimentsGoal,
  firstDay,
  instantText,
  oneOffGoal,
  thingAt,
  type AssessmentBook,
} from './assessment-samples.ts';
import { goalAssessmentsIn } from './goal-assessments.ts';

const hour = 3_600_000;

const live = firstDay + day;

function read(book: AssessmentBook, goal: Goal = experimentsGoal) {
  return book.inThePlaybook(goalAssessmentsIn(goal));
}

const sevenDays = 'Billing traced no paying customer to this experiment in seven days.';

async function judgedOnTheSeventhDay(book: AssessmentBook): Promise<string> {
  const quiet = await thingAt(book, { per: 'MAR-47', at: firstDay, marked: ['chosen', 'live'], live });
  await book.observed(quiet, live + hour, {
    measurement: { value: 0, final: false, as_of: live + hour },
    says: 'No paying customer yet.',
  });
  await book.observed(quiet, live + 7 * day, {
    measurement: { value: 0, final: true, as_of: live + 7 * day },
    says: sevenDays,
  });
  await book.observed(quiet, live + 7 * day, { marks: 'measured', says: 'Counted on the seventh day.' });
  await book.assessed(quiet, 'failed', live + 7 * day, 'final');
  return quiet;
}

describe('what an ended assessment was judged on', () => {
  it('is served as an open one serves it: the rule and milestones it was pinned with, the marks with their runs and times, and the measurements with their evidence', async () => {
    const book = assessmentBookOf();
    const quiet = await judgedOnTheSeventhDay(book);

    const [ended] = (await read(book)).closed.latest;

    expect(ended).toEqual({
      id: quiet,
      outcome: 'failed',
      by: 'final',
      at: instantText(live + 7 * day),
      per: { id: 'MAR-47', title: 'Experiment MAR-47' },
      window: { opens: instantText(live), closes: instantText(live + 7 * day), due: instantText(live + 8 * day) },
      value: 0,
      rule: { settles: 'on_crossing', target: { at_least: 1 } },
      milestones: experimentsGoal.milestones,
      marks: [
        { milestone: 'chosen', at: instantText(firstDay), run: 'run-1' },
        { milestone: 'live', at: instantText(firstDay + 1), run: 'run-2' },
        { milestone: 'measured', at: instantText(live + 7 * day), run: 'run-5' },
      ],
      measurement: {
        value: 0,
        final: true,
        as_of: instantText(live + 7 * day),
        at: instantText(live + 7 * day),
        run: 'run-4',
        says: sevenDays,
      },
      final_measurement: {
        value: 0,
        as_of: instantText(live + 7 * day),
        at: instantText(live + 7 * day),
        run: 'run-4',
      },
    });
  });
});

describe('the marks of an ended assessment', () => {
  it('leaves out the sentence a mark came with, which the current assessment carries, to keep sixty of them within a page', async () => {
    const book = assessmentBookOf();
    await judgedOnTheSeventhDay(book);

    const { current, closed } = await read(book);

    expect(closed.latest[0]?.marks?.at(-1)).toEqual({
      milestone: 'measured',
      at: instantText(live + 7 * day),
      run: 'run-5',
    });
    expect(current?.marks.at(-1)).toEqual({
      milestone: 'measured',
      at: instantText(live + 7 * day),
      run: 'run-5',
      says: 'Counted on the seventh day.',
    });
  });
});

describe('the number an ended assessment was judged on', () => {
  it('is the final number of a week judged at its close', async () => {
    const book = assessmentBookOf();
    const week = { opens: firstDay, closes: firstDay + 7 * day, due: firstDay + 7 * day + 8 * hour };
    const cost = await book.opened(costGoal, firstDay, { window: week });
    await book.observed(cost, week.closes + 7 * hour, { measurement: { value: 45, final: true, as_of: week.closes } });
    await book.assessed(cost, 'passed', week.due, 'final');

    expect((await read(book, costGoal)).closed.latest).toEqual([
      {
        id: cost,
        outcome: 'passed',
        at: instantText(week.due),
        window: { opens: instantText(week.opens), closes: instantText(week.closes), due: instantText(week.due) },
        value: 45,
        by: 'final',
        rule: { settles: 'at_close', target: { at_most: 50 } },
        milestones: [],
        marks: [],
        measurement: {
          value: 45,
          final: true,
          as_of: instantText(week.closes),
          at: instantText(week.closes + 7 * hour),
          run: 'run-1',
        },
        final_measurement: {
          value: 45,
          as_of: instantText(week.closes),
          at: instantText(week.closes + 7 * hour),
          run: 'run-1',
        },
      },
    ]);
  });
});

describe('the number an ended assessment of a goal with no window was judged on', () => {
  it('is the crossing', async () => {
    const book = assessmentBookOf();
    const sale = await book.opened(oneOffGoal, firstDay);
    await book.observed(sale, firstDay + day, { measurement: { value: 1, final: false, as_of: firstDay + day } });
    await book.assessed(sale, 'passed', firstDay + day);

    expect((await read(book, oneOffGoal)).current).toMatchObject({ id: sale, verdict: 'passed' });
    expect((await read(book, oneOffGoal)).closed.latest).toEqual([
      {
        id: sale,
        outcome: 'passed',
        at: instantText(firstDay + day),
        value: 1,
        by: 'crossing',
        rule: { settles: 'on_crossing', target: { at_least: 1 } },
        milestones: [],
        marks: [],
        measurement: {
          value: 1,
          final: false,
          as_of: instantText(firstDay + day),
          at: instantText(firstDay + day),
          run: 'run-1',
        },
      },
    ]);
  });
});
