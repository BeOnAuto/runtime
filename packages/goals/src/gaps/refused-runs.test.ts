import type { Goal } from '@on.auto/definitions/goals';
import { playbookLedgerOf } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { built, measuring, noReads } from '../assessor/assessor-fixtures.ts';
import {
  controls,
  deliveredAll,
  experiments,
  finished,
  monday,
  sales,
  type Book,
} from '../assessor/assessor-ledger.ts';
import { assessorOf } from '../assessor/assessor.ts';
import { observationGapsIn } from './observation-gaps.ts';

const minute = 60_000;

const visits: Goal = {
  id: 'visits-grow',
  statement: 'The site reaches a million visits.',
  success: {
    label: 'Visits',
    settles: 'on_crossing',
    target: { at_least: 1_000_000 },
    passed: 'Reached',
    failed: 'Missed',
  },
  notify: { passed: 'quiet', failed: 'quiet' },
};

const visitsCounted = [{ goal: 'visits-grow', purpose: 'Counts the visits.', measures: '/visits' }];

interface Ran {
  readonly index: number;
  readonly workflow: string;
  readonly version: number;
  readonly output: unknown;
}

async function countingOf(workflow: string, savedVersion: number, contributes: Schema.Json) {
  const clock = { now: monday };
  const { book, ports } = await built(noReads, () => clock.now);
  await book.goalsSaved([experiments, controls, visits], 2);
  await book.workflowSaved(workflow, savedVersion, contributes);
  const assessor = assessorOf(ports);
  const ranAt = async ({ index, version, output }: Omit<Ran, 'workflow'>) => {
    clock.now = monday + index * minute;
    await deliveredAll(
      assessor,
      finished({
        id: `c${String(index)}`,
        run: `run-${String(index)}`,
        workflow,
        version,
        at: clock.now,
        data: { output },
      }),
    );
  };
  return { book, ranAt };
}

function inTurn(runs: readonly (() => Promise<void>)[]): Promise<void> {
  return runs.reduce<Promise<void>>(async (before, next) => {
    await before;
    await next();
  }, Promise.resolve());
}

function gapsNow(book: Book, version: number) {
  return Effect.runPromise(
    Effect.provideContext(
      observationGapsIn({
        goals: [visits],
        workflows: [{ name: 'counts', version, paused: false, contributes: visitsCounted }],
      }),
      playbookLedgerOf(book.ledger, sales),
    ),
  ).then((gaps) => gaps.map(({ kind }) => kind));
}

async function observedNow(book: Book): Promise<number> {
  const facts = await book.factsOf(`assessments/${assessmentIdOf({ goal: 'visits-grow' })}`);
  return facts.filter((type) => type === 'goal_observed').length;
}

describe('a counted run after a refusal that repeats the last number', () => {
  it('is recorded, so the gap goes at that run, while unchanged numbers with no gap still append nothing', async () => {
    const { book, ranAt } = await countingOf('counts', 1, visitsCounted);
    await inTurn([0, 1, 2].map((index) => () => ranAt({ index, version: 1, output: { visits: 12 } })));
    const steady = await observedNow(book);
    await ranAt({ index: 3, version: 1, output: { visits: 'unreadable' } });
    const refused = await gapsNow(book, 1);
    await book.workflowSaved('counts', 2, visitsCounted);
    await ranAt({ index: 4, version: 2, output: { visits: 12 } });
    const repaired = [await gapsNow(book, 2), await observedNow(book)];
    await inTurn([5, 6].map((index) => () => ranAt({ index, version: 2, output: { visits: 12 } })));

    expect([steady, refused, repaired, await observedNow(book)]).toEqual([1, ['observation_refused'], [[], 2], 2]);
  });
});

describe('a refusal for one goal of a workflow counted for another goal', () => {
  it('is recorded once a UTC day, since a run counted for another goal clears no gap of this one', async () => {
    const { book, ranAt } = await countingOf('measure', 2, [
      ...measuring,
      { goal: 'visits-grow', purpose: 'Counts the visits.', measures: '/visits' },
    ]);
    await inTurn(
      Array.from(
        { length: 600 },
        (_, index) => () => ranAt({ index, version: 2, output: { results: 3, visits: index } }),
      ),
    );

    expect(await book.factsOf('goal-refusals/paying-customers.measure')).toEqual(['goal_observation_refused']);
    expect(Object.values(await book.rows('goal_observations')).map(({ entry }) => entry)).toEqual([1]);
  });
});
