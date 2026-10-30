import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { weekdaysAndWeekends, weeklyOrderRows as weeklyRows } from '../build-testing/uploaded-rows.ts';
import { candidateSha256 } from '../runtime-testing/scripted-candidates.ts';
import { uploadedDailyTotals } from '../testing/daily-documents.ts';
import { uploadedWeeklyOrders } from '../testing/weekly-orders.ts';

describe('a build of a function that predicts a total to the end of the week', () => {
  it('scores the total against the run-rate, builds the version in a run of no output shape, and answers the total to the end of the next week', async () => {
    const playbook = buildPlaybook();
    const source = uploadedDailyTotals(weekdaysAndWeekends.sha256).replace(
      '  holdout: 14',
      '  holdout: 14\n  baselines: [persistence]\n  coverage_floor: 0.6',
    );
    await savedFunction(playbook, { name: 'weekly-sales', rows: weekdaysAndWeekends, source });
    const build = await builtFrom(playbook, ['totals-run-rate'], 'weekly-sales');

    const built = await runOf(playbook, build);

    expect(built).toMatchObject({
      output: { status: 'succeeded', output: { version: 1, winner: candidateSha256('totals-run-rate') } },
    });
    expect(built).not.toHaveProperty('output.output_shape');
    expect(await asked(playbook, { series: 'north' }, { name: 'weekly-sales' })).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          unit: 'sales',
          period: 'day',
          origin: '2026-10-25',
          lines: [{ name: 'observed' }, { name: 'total', points: [{ at: '2026-11-01', value: 78 }] }],
        },
        record: { version: 1, total_to: '2026-W44' },
      },
    });
  });
});

describe('a build of a function whose data has features and given features', () => {
  it('feeds them to the candidate, scores no baseline that walks no series, and answers a question with its given', async () => {
    const playbook = buildPlaybook();
    const source = uploadedWeeklyOrders(weeklyRows.sha256).replace(
      '  holdout: 12',
      '  holdout: 12\n  baselines: [seasonal-naive]',
    );
    await savedFunction(playbook, { name: 'weekly-orders', rows: weeklyRows, source });
    const build = await builtFrom(playbook, ['orders-last'], 'weekly-orders');

    expect((await workOf(playbook, build)).at(-1)).toMatchObject({
      type: 'baseline_not_walked',
      data: { baseline: 'seasonal-naive', because: 'too_short' },
    });
    expect(
      await asked(playbook, { series: 'north', horizon: 4, given: { promotion: 1 } }, { name: 'weekly-orders' }),
    ).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          origin: '2026-W40',
          lines: [{ name: 'observed' }, { name: 'predicted', points: [{ at: '2026-W44', value: 5, low: 3, high: 7 }] }],
        },
      },
    });
  });
});
