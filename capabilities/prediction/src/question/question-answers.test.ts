import { shapeNamed } from '@on.auto/definitions/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { activeVisitsOn, asked, builtFrom, savedFunction, visitsRows } from '../build-testing/built-versions.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import { dailyRows } from '../testing/daily-rows.ts';

const someMilliseconds: unknown = expect.any(Number);

const AnsweredSchema = Schema.Struct({ output: Schema.Struct({ output: Schema.Json }) });

const steadySouth = {
  unit: 'visits',
  period: 'day',
  origin: '2026-10-09',
  lines: [
    {
      name: 'observed',
      points: [
        { at: '2026-10-06', value: 20 },
        { at: '2026-10-07', value: 21 },
        { at: '2026-10-08', value: 22 },
        { at: '2026-10-09', value: 20 },
      ],
    },
    {
      name: 'predicted',
      points: [
        { at: '2026-10-10', value: 21, low: 19, high: 23 },
        { at: '2026-10-11', value: 21, low: 19, high: 23 },
      ],
    },
  ],
};

function tenthsWithAGap(_series: string, day: number): number | null {
  return day === 38 ? null : 10 + (day % 3) / 10;
}

const gappyRows = dailyRows('visits', ['north'], 40, tenthsWithAGap);

describe('the answer to a question to a prediction function', () => {
  it('is a series of the last periods of its history and of every horizon, from the last period of its dataset', async () => {
    const playbook = await activeVisitsOn(buildPlaybook());
    const answer = await asked(playbook, { series: 'south' });

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'succeeded',
        output_shape: 'series',
        output: steadySouth,
        record: {
          version: 1,
          runtime: { name: 'scripted-runtime', version: '1.0.0' },
          coverage: 0.8,
          origin: '2026-10-09',
          dataset_checkpoint: null,
          duration_ms: someMilliseconds,
        },
      },
    });
    expect(Schema.decodeUnknownSync(AnsweredSchema)(answer).output.output).toEqual(steadySouth);
    expect(shapeNamed('series').check(steadySouth)).toEqual([]);
  });
});

describe('the horizons in the answer to a question to a prediction function', () => {
  it('are every horizon nearest first, however the document orders them', async () => {
    const playbook = buildPlaybook();
    const source = uploadedDailyVisits(visitsRows.sha256).replace('  horizons: [1, 2]', '  horizons: [2, 1]');
    await savedFunction(playbook, { source });
    await builtFrom(playbook, ['visits-mean']);

    expect(await asked(playbook, { series: 'south' })).toMatchObject({
      output: {
        status: 'succeeded',
        output: { lines: [{}, { points: [{ at: '2026-10-10' }, { at: '2026-10-11' }] }] },
      },
    });
  });

  it('holds the one horizon the question names, with the marks it gives', async () => {
    const playbook = await activeVisitsOn(buildPlaybook());
    const marks = [{ label: 'Goal', value: 12 }];

    expect(await asked(playbook, { series: 'north', horizon: 2, marks })).toMatchObject({
      output: {
        output: {
          lines: [
            { name: 'observed' },
            { name: 'predicted', points: [{ at: '2026-10-11', value: 11, low: 9, high: 13 }] },
          ],
          marks,
        },
      },
    });
  });
});

describe('the history in the answer to a question to a prediction function', () => {
  it('shows its values as the rows hold them, leaves out a period without one, and shows none at a history of 0', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook, { rows: gappyRows });
    await builtFrom(playbook, ['visits-observed-mean']);
    const shown = await asked(playbook, { series: 'north', horizon: 1 });
    await playbook.call(playbook.operations.update, {
      type: 'prediction',
      name: 'daily-visits',
      source: uploadedDailyVisits(gappyRows.sha256).replace('  unit: visits', '  unit: visits\n  history: 0'),
    });

    expect(shown).toMatchObject({
      output: {
        output: {
          lines: [
            {
              name: 'observed',
              points: [
                { at: '2026-10-06', value: 10 },
                { at: '2026-10-07', value: 10.1 },
                { at: '2026-10-09', value: 10 },
              ],
            },
            {},
          ],
        },
      },
    });
    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      output: { output: { origin: '2026-10-09', lines: [{ name: 'observed', points: [] }, { name: 'predicted' }] } },
    });
  });
});

describe('a question to a version whose format no model runtime of the server executes', () => {
  it('is unavailable, its model process failed because no runtime executes the format, until a runtime does', async () => {
    const runtimes = [scriptedRuntime];
    const playbook = await activeVisitsOn(buildPlaybook({ runtimes }));
    runtimes.splice(0);

    expect(await asked(playbook, { series: 'south' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'model_process_failed',
      because: 'no_model_runtime',
      detail:
        'No model runtime this server has installed executes the format scripted of version 1; install the extension that executes it, or ask for a build',
    });
  });
});
