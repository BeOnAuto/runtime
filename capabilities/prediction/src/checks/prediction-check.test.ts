import { savedIn } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { poolOf, predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const atTheDataTest: unknown = expect.stringMatching(/^Line 12, \/data\/events\/0\/data: /u);

function tested(expression: string): string {
  return weeklyOrdersWith(['    - type: order.placed', `    - type: order.placed\n      data: '\${ ${expression} }'`]);
}

describe('the check of a prediction function when it is saved', () => {
  it('strips nothing from a document with no data test', async () => {
    expect(await Effect.runPromise(predictionRuns().prepared(weeklyOrders).check(savedIn))).toEqual({});
  });

  it('keeps what it stripped of a data test that names $data alone, and refuses one that names more at its line', async () => {
    const pool = poolOf();
    const stripped = await Effect.runPromise(
      predictionRuns(pool).prepared(tested('($data as { region: string }).region !== "test"')).check(savedIn),
    );
    const refused = await Effect.runPromise(
      Effect.flip(predictionRuns(pool).prepared(tested('$workflow.input.region === $data.region')).check(savedIn)),
    );

    expect(stripped).toEqual({
      expressions: {
        ' ($data as { region: string }).region !== "test" ': ' ($data                      ).region !== "test" ',
      },
    });
    expect(refused).toMatchObject({ issues: [{ pointer: '', detail: atTheDataTest }] });
  });
});
