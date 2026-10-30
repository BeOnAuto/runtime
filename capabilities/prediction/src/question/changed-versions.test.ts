import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, savedFunction, visitsRows } from '../build-testing/built-versions.ts';
import { weekdaysAndWeekends, weeklyOrderRows } from '../build-testing/uploaded-rows.ts';
import { uploadedDailyTotals, uploadedDailyVisits } from '../testing/daily-documents.ts';
import { uploadedWeeklyOrders } from '../testing/weekly-orders.ts';

const signatureChanged = {
  status: 'rejected',
  reason: 'conflict',
  kind: 'data_changed',
  detail:
    'The horizons, the given features or the total changed since version 1 was built, so its model no longer fits the rows; ask for a build',
};

async function updatedTo(playbook: BuildPlaybook, name: string, source: string): Promise<void> {
  expect(await playbook.call(playbook.operations.update, { type: 'prediction', name, source })).toMatchObject({
    status: 'succeeded',
  });
}

function updated(playbook: BuildPlaybook, replaced: string, by: string): Promise<void> {
  return updatedTo(playbook, 'daily-visits', uploadedDailyVisits(visitsRows.sha256).replace(replaced, by));
}

describe('a question after its function was edited', () => {
  it('is answered by the active version after an edit that leaves the horizons, the given features and the total alone', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    await updated(playbook, 'Fit a model', 'Fit one model');

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      output: { status: 'succeeded', record: { version: 1 } },
    });
  });

  it('is refused once the horizons changed since its version was built, as the data part changing is', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    await updated(playbook, '  horizons: [1, 2]', '  horizons: [1]');

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject(signatureChanged);
  });
});

describe('a question after the features a question gives or the total were edited', () => {
  it('is refused once the given features changed since its version was built', async () => {
    const playbook = buildPlaybook();
    const source = uploadedWeeklyOrders(weeklyOrderRows.sha256).replace(
      '  holdout: 12',
      '  holdout: 12\n  baselines: [seasonal-naive]',
    );
    await savedFunction(playbook, { name: 'weekly-orders', rows: weeklyOrderRows, source });
    await builtFrom(playbook, ['orders-last'], 'weekly-orders');
    await updatedTo(playbook, 'weekly-orders', source.replace('  given: [promotion]\n', ''));

    expect(await asked(playbook, { series: 'north', horizon: 4 }, { name: 'weekly-orders' })).toMatchObject(
      signatureChanged,
    );
  });

  it('is refused once the total it sums changed since its version was built', async () => {
    const playbook = buildPlaybook();
    const source = uploadedDailyTotals(weekdaysAndWeekends.sha256).replace(
      '  holdout: 14',
      '  holdout: 14\n  baselines: [persistence]\n  coverage_floor: 0.6',
    );
    await savedFunction(playbook, { name: 'weekly-sales', rows: weekdaysAndWeekends, source });
    await builtFrom(playbook, ['totals-run-rate'], 'weekly-sales');
    await updatedTo(
      playbook,
      'weekly-sales',
      source.replace('  accumulates: week', '  horizons: [1]').replace('{{ dataset.accumulates }}', 'week'),
    );

    expect(await asked(playbook, { series: 'north', horizon: 1 }, { name: 'weekly-sales' })).toMatchObject(
      signatureChanged,
    );
  });
});
