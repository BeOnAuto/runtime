import { mostExpressionWork } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { contributed, experiments } from '../observations/observation-examples.ts';
import { observationsOf } from '../observations/observations.ts';
import { measured, neverEnds, opened, results, runOf, twentyCheckpoints, endedAt } from './condition-samples.ts';
import { mostConditionsKept, mostConditionWork, runConditionsOf } from './run-conditions.ts';

describe('the conditions of one run', () => {
  it('are evaluated item by item in one session, at the moment the run ended, false and null observing nothing', async () => {
    const { sandbox, closed } = opened();
    const conditions = runConditionsOf(sandbox);
    const output = {
      results: [{ status: 'measured' }, { status: 'open' }, { status: null }],
      checked: null,
      count: 0,
    };

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(
        runOf(output, [
          { when: measured, each: '/results' },
          { when: `\${ Date.now() == ${endedAt} }` },
          { when: '${ $data.checked }' },
          {},
          { when: '${ $data.count }' },
          { when: '$data.count == 0' },
        ]),
      ),
    );

    expect(verdicts).toEqual([[true, false, false], [true], [null], undefined, [true], [true]]);
    expect([conditions.spent().sessions, closed()]).toEqual([1, 1]);
  });

  it('refuses a condition that throws or never ends on its own, and goes on with the rest', async () => {
    const conditions = runConditionsOf(opened().sandbox);

    const verdicts = await Effect.runPromise(
      conditions.verdictsOf(
        runOf({ status: 'measured' }, [{ when: '${ $data.nope.deeper }' }, { when: neverEnds }, { when: measured }]),
      ),
    );

    expect(verdicts).toEqual([
      [{ failed: "TypeError: cannot read property 'deeper' of undefined" }],
      [
        {
          failed: `The program did more work than it may: a condition may do ${mostExpressionWork} checkpoints of work`,
        },
      ],
      [true],
    ]);
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 3, work: 1 + mostExpressionWork + 1 + 1 });
  });
});

describe('the conditions of a large run', () => {
  it('evaluates 800 conditions of eight entries in one session, each source defined once', async () => {
    const { sandbox, closed } = opened();
    const defined: string[] = [];
    const conditions = runConditionsOf({
      ...sandbox,
      session: async (opening) => {
        const session = await sandbox.session(opening);
        return {
          ...session,
          define: (source) => {
            defined.push(source);
            return session.define(source);
          },
        };
      },
    });
    const entries = Array.from({ length: 8 }, () => ({ when: measured, each: '/results' }));

    const verdicts = await Effect.runPromise(conditions.verdictsOf(runOf(results(100), entries)));

    expect(verdicts).toEqual(entries.map(() => Array.from({ length: 100 }, () => true)));
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 800, work: 800 });
    expect([defined.length, closed()]).toEqual([1, 1]);
  });
});

describe('the budget of the conditions of a run', () => {
  it('leaves what the budget does not reach not reached, the same on every evaluation, and the core refuses it', async () => {
    const entries = [
      { when: measured, each: '/results' },
      ...Array.from({ length: 7 }, () => ({ when: twentyCheckpoints, each: '/results' })),
    ];
    const evaluated = async () => {
      const conditions = runConditionsOf(opened().sandbox);
      const verdicts = await Effect.runPromise(conditions.verdictsOf(runOf(results(100), entries)));
      return { verdicts, spent: conditions.spent() };
    };

    const [first, second] = [await evaluated(), await evaluated()];

    expect(second).toEqual(first);
    expect(first.spent).toEqual({ sessions: 1, evaluations: 295, work: mostConditionWork });
    expect(first.spent.evaluations).toBeLessThan(800);
    expect(first.spent.work).toBeLessThanOrEqual(mostConditionWork);
    expect(first.verdicts.slice(0, 2)).toEqual([
      Array.from({ length: 100 }, () => true),
      Array.from({ length: 100 }, () => true),
    ]);
    expect(first.spent.evaluations).toBeGreaterThan(200);
    expect(first.verdicts[2]).toHaveLength(first.spent.evaluations - 200);
    expect(first.verdicts.slice(3)).toEqual(Array.from({ length: 5 }, () => 'not_reached'));
    const cut = first.verdicts[2];
    const lastReached = first.spent.evaluations - 200;
    const refused = observationsOf(
      contributed(
        experiments,
        { when: twentyCheckpoints, each: '/results', per_id: '/issue', marks: 'measured' },
        results(100),
        cut,
      ),
    ).refused.map(({ detail }) => detail);
    expect(refused).toHaveLength(100 - lastReached);
    expect(refused[0]).toBe(`/contributes/0, item ${lastReached}: the condition took too long`);
    expect(
      observationsOf(
        contributed(
          experiments,
          { when: twentyCheckpoints, each: '/results', per_id: '/issue' },
          results(1),
          'not_reached',
        ),
      ).refused,
    ).toHaveLength(1);
  });
});

describe('the conditions kept within a pass', () => {
  it('opens no session for a run with no condition, and evaluates a run once while it is kept', async () => {
    const conditions = runConditionsOf(opened().sandbox);
    const run = runOf({ status: 'measured' }, [{ when: measured }]);

    await Effect.runPromise(conditions.verdictsOf(runOf({}, [{}], 'record-0')));
    const verdicts = [
      await Effect.runPromise(conditions.verdictsOf(run)),
      await Effect.runPromise(conditions.verdictsOf(run)),
    ];
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostConditionsKept }, (_, each) => `record-${each + 2}`),
        (record) => conditions.verdictsOf(runOf({}, [{ when: measured }], record)),
      ),
    );
    await Effect.runPromise(conditions.verdictsOf(run));

    expect(verdicts).toEqual([[[true]], [[true]]]);
    expect(conditions.spent().sessions).toBe(2 + mostConditionsKept);
  });

  it('is tried again later when the sandbox cannot be reached', async () => {
    const conditions = runConditionsOf({ clock: () => 0, session: () => Promise.reject(new Error('no worker')) });

    const failure = await Effect.runPromise(Effect.flip(conditions.verdictsOf(runOf({}, [{ when: measured }]))));

    expect(failure).toMatchObject({ _tag: 'unavailable' });
  });
});
