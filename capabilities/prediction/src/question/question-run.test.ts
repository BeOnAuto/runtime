import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { activeVisitsOn, asked } from '../build-testing/built-versions.ts';
import { scriptedModels, type ScriptedModels } from '../build-testing/scripted-models.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';
import type { PortOptions } from '../testing/prediction-ports.ts';
import { uploadDataset } from '../upload/upload-dataset.ts';

const heldWalk = { rows: '/held.csv', window: 3, holdout: 1, steps: 1, features: 0, given: [], remaining: null };

const outOfOrder = 'The answer does not match the series shape';

function activeVisits(options: PortOptions = {}): Promise<BuildPlaybook> {
  return activeVisitsOn(buildPlaybook(options));
}

type Deadlines = NonNullable<PortOptions['deadlines']>;

const ordinaryDeadlines: Deadlines = { check: 30_000, run: 10_000, walk: 60_000, baselines: 30_000 };

async function scriptedVisits(deadlines: Deadlines = ordinaryDeadlines, processes = 4) {
  const scripted: ScriptedModels = scriptedModels();
  const playbook = await activeVisits({ module: scripted.module, deadlines, processes });
  return { scripted, playbook };
}

describe('a question to a prediction function', () => {
  it('is refused for a series its dataset does not hold, and once the data part changed since its version was built', async () => {
    const playbook = await activeVisits();
    const unknown = await asked(playbook, { series: 'east', horizon: 1 });
    const more = dailyRows('visits', ['east', 'north', 'south'], 40, steadyVisits);
    await playbook.send(uploadDataset(playbook.test.ports.ledger.content), { sha256: more.sha256 }, more.text);
    await playbook.call(playbook.operations.update, {
      type: 'prediction',
      name: 'daily-visits',
      source: uploadedDailyVisits(more.sha256),
    });

    expect([unknown, await asked(playbook, { series: 'north', horizon: 1 })]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', detail: 'The dataset holds no series "east" in its window' },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'data_changed',
        detail:
          'The data part changed since version 1 was built, so its model no longer fits the rows; ask for a build',
      },
    ]);
  });
});

describe('a question whose model process does not answer', () => {
  it('fails as the model process failing when it ends, runs out of memory or answers numbers that are not finite', async () => {
    const { scripted, playbook } = await scriptedVisits();
    scripted.next('exits');
    const exited = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('allocates');
    const exhausted = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('not-finite');
    const notFinite = await asked(playbook, { series: 'north', horizon: 1 });
    scripted.next('unreadable');
    const unread = await asked(playbook, { series: 'north', horizon: 1 });

    expect(unread).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      detail: 'The model process ended before it read the dataset',
    });
    expect([exited, exhausted, notFinite]).toMatchObject([
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        detail: 'The process ended with code 3 before it answered',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        detail: 'The model process ended before it answered',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        because: 'not_finite',
        detail: 'The model answered something other than finite numbers in the shape its signature gives',
      },
    ]);
  });
});

describe('a question whose model answers a low above its likely value or a high below it', () => {
  it('is refused as the model process failing, because its numbers are not in order, in the words of the series shape', async () => {
    const { scripted, playbook } = await scriptedVisits();
    scripted.next('low-above');
    const lowAbove = await asked(playbook, { series: 'north' });
    scripted.next('high-below');
    const highBelow = await asked(playbook, { series: 'north' });

    expect([lowAbove, highBelow]).toMatchObject([
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        because: 'not_in_order',
        detail: `${outOfOrder}: /lines/1/points/0/low: Expected a low of at most the value`,
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'model_process_failed',
        because: 'not_in_order',
        detail: `${outOfOrder}: /lines/1/points/1/high: Expected a high of at least the value`,
      },
    ]);
  });
});

describe('a question whose model processes are all taken', () => {
  it('is told every model process is busy while every one is taken', async () => {
    const scripted = scriptedModels();
    const deadlines = { check: 60_000, run: 300, walk: 60_000, baselines: 30_000 };
    const playbook = await activeVisits({ module: scripted.module, deadlines, processes: 3, longJobs: 3 });
    scripted.next('sleeps');
    const { models } = playbook.test.ports;
    for (const held of ['first', 'second', 'third']) {
      void Effect.runPromise(models.walk(scriptedRuntime, { sha256: held, path: `/${held}.scripted` }, heldWalk));
    }
    await scripted.untilSleeping(['walk', 'walk', 'walk']);

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_busy',
    });
  });
});
