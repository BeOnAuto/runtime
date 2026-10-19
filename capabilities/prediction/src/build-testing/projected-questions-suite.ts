import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { periodForm, periodOfDay } from '../periods/grains.ts';
import { asked, buildAsked, builtFrom, modelFactsOf } from './built-versions.ts';
import { performedUntilQuiet } from './due-driving.ts';
import { orders, tenthVisits, totals, visits } from './projected-fixtures.ts';
import { day, projectedSales } from './projected-visits.ts';
import { today } from './suite-clock.ts';

const testTimeoutMs = 120_000;

const someCheckpoint: unknown = expect.any(String);

const aWeek: unknown = expect.stringMatching(/^\d{4}-W\d{2}$/u);

function questions(settingsOf: SettingsOf): void {
  it('reads the last window of its series at the checkpoint of the dataset, and its history as the rows hold it', async () => {
    const { playbook } = await projectedSales(settingsOf, tenthVisits);
    await builtFrom(playbook, ['visits-mean']);
    const history = [4, 3, 2, 1].map((ago) => today - ago);

    expect(await asked(playbook, { series: 'north' })).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          origin: periodForm('day', today - 1),
          lines: [
            {
              name: 'observed',
              points: history.map((each) => ({ at: periodForm('day', each), value: tenthVisits.valueOf(10, each) })),
            },
            { name: 'predicted', points: [{ at: periodForm('day', today) }, { at: periodForm('day', today + 1) }] },
          ],
        },
        record: { version: 1, dataset_checkpoint: someCheckpoint },
      },
    });
    expect(await asked(playbook, { series: 'east', horizon: 1 })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });

  it('is refused while its dataset is not made, and fails when its database fails', async () => {
    const projected = await projectedSales(settingsOf, visits);
    await builtFrom(projected.playbook, ['visits-mean']);
    projected.read('empty');
    const notReady = await asked(projected.playbook, { series: 'north', horizon: 1 });
    projected.read('failing');
    const failed = await asked(projected.playbook, { series: 'north', horizon: 1 });

    expect([notReady, failed]).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'dataset_not_ready' },
      { status: 'failed' },
    ]);
  });
}

function busy(settingsOf: SettingsOf): void {
  it('is told every model process is busy while builds hold every one', async () => {
    const deadlines = { check: 30_000, run: 300, walk: 60_000, baselines: 30_000 };
    const projected = await projectedSales(settingsOf, { ...visits, deadlines, processes: 2, longJobs: 2 });
    await builtFrom(projected.playbook, ['visits-mean']);
    projected.scripted.next('sleeps');
    const { models } = projected.playbook.test.ports;
    const walk = { rows: '/held.csv', window: 3, holdout: 1, steps: 1, features: 0, given: [], remaining: null };
    for (const held of ['first', 'second']) {
      void Effect.runPromise(models.walk({ sha256: held, path: `/${held}.onnx` }, walk));
    }
    await projected.scripted.untilSleeping(['walk', 'walk']);

    expect(await asked(projected.playbook, { series: 'north', horizon: 1 })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_busy',
    });
  });
}

function featured(settingsOf: SettingsOf): void {
  it('feeds the features of each period and the given ones ahead, a period without a feature as NaN', async () => {
    const { playbook } = await projectedSales(settingsOf, orders);
    await builtFrom(playbook, ['orders-last'], 'weekly-orders');
    const week = periodOfDay('week', today);

    expect(
      await asked(playbook, { series: 'north', horizon: 4, given: { promotion: 1 } }, { name: 'weekly-orders' }),
    ).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          origin: periodForm('week', week - 1),
          lines: [{}, { points: [{ at: periodForm('week', week + 3), value: 1, low: -1, high: 3 }] }],
        },
      },
    });
  });
}

function totalsAndBounds(settingsOf: SettingsOf): void {
  it('shadows a total to the end of the enclosing week at the close of the week', async () => {
    const projected = await projectedSales(settingsOf, totals);
    await builtFrom(projected.playbook, ['totals-run-rate'], 'weekly-sales');
    await builtFrom(projected.playbook, ['totals-run-rate'], 'weekly-sales');
    await performedUntilQuiet(projected.playbook, 16 * day);
    const facts = await modelFactsOf(projected.playbook, 'weekly-sales');

    expect(facts.filter(({ type }) => type === 'shadow_graded')).toMatchObject([
      { data: { of: 2, period: aWeek } },
      { data: { of: 1 } },
    ]);
    expect(facts.at(-1)).toMatchObject({ type: 'version_activated', data: { version: 2 } });
  });

  it('is refused as too large past the rows a build takes', async () => {
    const base = Object.fromEntries(
      Array.from({ length: 1001 }, (_, at) => [`store-${String(at).padStart(4, '0')}`, 10]),
    );
    const { playbook } = await projectedSales(settingsOf, { ...visits, base, before: 10, after: 0 });

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'dataset_too_large',
    });
  });
}

export function projectedQuestionsSuite(settingsOf: SettingsOf): void {
  describe('a question over a projected dataset', { timeout: testTimeoutMs }, () => {
    questions(settingsOf);
  });

  describe('a question over a projected dataset while builds hold every process', { timeout: testTimeoutMs }, () => {
    busy(settingsOf);
  });

  describe('a question over a projected dataset with features', { timeout: testTimeoutMs }, () => {
    featured(settingsOf);
  });

  describe('a total and the bounds of a build over a projected dataset', { timeout: testTimeoutMs }, () => {
    totalsAndBounds(settingsOf);
  });
}
