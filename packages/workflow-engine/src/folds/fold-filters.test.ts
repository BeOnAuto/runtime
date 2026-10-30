import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { sourcesUnderTest, type SourceUnderTest } from '../pool-testing/test-pools.ts';
import { filterContextOf, type FilterContext } from '../programs/kept-contexts.ts';
import type { Evaluation } from '../programs/program-run.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { matchingOf, preparedFilters, type Matching } from './fold-filters.ts';

const reviewed = { type: 'run_succeeded', subject: 'reasoning/review-brief' };

const evaluation: Evaluation = { budget: 500, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const prepared: readonly (SourceUnderTest & { readonly context: FilterContext })[] = await Promise.all(
  sourcesUnderTest.map(async ({ name, source }) => ({
    name,
    source,
    context: filterContextOf(
      await source(unitMemoryBytes),
      { stackBytes: threadStackBytes, mostAnswerBytes: 1000, clock: () => 0 },
      evaluation,
    ),
  })),
);

function succeeded(verdict: Json): JsonObject {
  return { ...reviewed, source: '/runs/run', data: { output: { campaign: 'spring', verdict } } };
}

function matched(context: FilterContext, filters: readonly JsonObject[], event: JsonObject, budget = 500): Matching {
  return matchingOf(preparedFilters(filters, context.define), event, (test, actual) =>
    test(JSON.stringify(actual), { ...evaluation, budget }),
  );
}

function workOf(matching: Matching): number {
  return 'work' in matching ? matching.work : 0;
}

const rejected = [{ ...reviewed, data: '${ $data.output.verdict.toUpperCase() == "REJECT" }' }];

const busyApproval = {
  type: 'run_succeeded',
  data: '${ (() => { let sum = 0; for (let index = 0; index < 100000; index++) sum += index; return sum > 0 && $data.output.verdict == "approve" })() }',
};

describe.each(prepared)('the filters of a view on $name instances', ({ context }) => {
  it('match an event by its type, subject and data', () => {
    expect(matched(context, rejected, succeeded('reject'))).toMatchObject({ matched: true });
    expect(matched(context, rejected, succeeded('approve'))).toMatchObject({ matched: false });
  });

  it('leave out an event whose data the filter cannot test', () => {
    expect(matched(context, rejected, succeeded(7))).toMatchObject({ matched: false });
  });

  it('never match an event that lacks an attribute a filter names', () => {
    expect(matched(context, [{ type: 'run_succeeded', time: '2026-10-01T09:00:00Z' }], succeeded('reject'))).toEqual({
      matched: false,
      work: 0,
    });
  });

  it('never match by a filter that names no type', () => {
    expect(matched(context, [{ subject: 'reasoning/review-brief' }], succeeded('reject'))).toEqual({
      matched: false,
      work: 0,
    });
  });

  it('match when any one filter matches, counting the work of every test they ran', () => {
    const alone = matched(context, rejected, succeeded('reject'));
    const both = matched(context, [busyApproval, ...rejected], succeeded('reject'));

    expect(both).toMatchObject({ matched: true });
    expect(workOf(both)).toBeGreaterThan(workOf(alone));
  });

  it('stop at a test that runs out of its budget', () => {
    expect(matched(context, [busyApproval], succeeded('approve'), 1)).toMatchObject({
      stopped: { ran: 'exhausted', limit: 'work' },
    });
  });
});
