import type { ProgramRun } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answering, measured, neverEnds, opened, results, runOf } from './condition-samples.ts';
import { mostConditionWork, runConditionsOf } from './run-conditions.ts';

describe('a run whose evaluation is cut short', () => {
  it('leaves a condition the rest of the budget cannot finish not reached, though a whole budget would', async () => {
    const conditions = runConditionsOf(
      answering(
        { ran: 'answered', text: 'true', work: mostConditionWork - 10 },
        {
          ran: 'exhausted',
          limit: 'work',
          issue: { detail: 'The program did more work than it may', line: null },
          work: 11,
        },
      ),
    );

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(runOf({}, [{ when: measured }, { when: measured }])),
    );

    expect(verdicts).toEqual([[true], 'not_reached']);
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 2, work: mostConditionWork + 1 });
  });

  it('stops where the budget is spent exactly, before the next condition', async () => {
    const spent: ProgramRun = { ran: 'answered', text: 'true', work: mostConditionWork };
    const conditions = runConditionsOf(answering(spent));

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(runOf({}, [{ when: measured }, { when: measured }])),
    );

    expect(verdicts).toEqual([[true], 'not_reached']);
    expect(conditions.spent().evaluations).toBe(1);
  });
});

describe('a run whose sandbox stopped', () => {
  it('refuses a condition that ran past its deadline on a host whose clock moves, and leaves the rest not reached', async () => {
    const clock = { now: 0 };
    const conditions = runConditionsOf(
      opened(() => {
        clock.now += 1000;
        return clock.now;
      }).sandbox,
    );

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(runOf({}, [{ when: neverEnds }, { when: measured }])),
    );

    expect(verdicts).toEqual([[{ failed: 'The program ran past its deadline' }], 'not_reached']);
  });

  it('refuses a condition whose sandbox ran out of memory and leaves the rest not reached', async () => {
    const conditions = runConditionsOf(
      answering({ ran: 'exhausted', limit: 'memory', issue: { detail: 'out of memory', line: null }, work: 3 }),
    );

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(runOf({}, [{ when: measured }, { when: measured }])),
    );

    expect(verdicts).toEqual([[{ failed: 'out of memory' }], 'not_reached']);
  });
});

describe('the work the conditions of a run do', () => {
  it('counts an evaluation that did no work as one step', async () => {
    const conditions = runConditionsOf(answering({ ran: 'answered', text: 'false', work: 0 }));

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(runOf(undefined, [{ when: measured }, { when: measured }])),
    );

    expect(verdicts).toEqual([[false], [true]]);
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 2, work: 2 });
  });

  it('evaluates the first hundred items of an each and nothing where the each is no list', async () => {
    const conditions = runConditionsOf(opened().sandbox);

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(
        runOf({ ...results(150), single: { status: 'measured' } }, [
          { when: measured, each: '/results' },
          { when: measured, each: '/single' },
          { when: measured, each: '/missing' },
        ]),
      ),
    );

    expect(verdicts.map((verdict) => verdict?.length)).toEqual([100, 0, 0]);
  });
});
