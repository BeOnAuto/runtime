import { shapeNamed } from '@on.auto/definitions/testing';
import { InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cancelsInACall } from '../testing/cancels-in-a-call.ts';
import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const question = { series: 'north', horizon: 4 };

const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 1);

const pastItsBytes = { series: 'é'.repeat(200), horizon: 1 };

const questionsRefused: readonly (readonly [string, Schema.JsonObject, string])[] = [
  ['a series of 200 characters past its 256 bytes', pastItsBytes, '/series'],
  ['a horizon it does not predict', { series: 'north', horizon: 2 }, '/horizon'],
  ['a field a question does not take', { series: 'north', horizon: 1, given: { promotion: 1 } }, '/given'],
  ['no series', { horizon: 1 }, '/series'],
  [
    'nine marks',
    {
      series: 'north',
      marks: Array.from({ length: 9 }, (_, at) => ({ label: `Mark ${at}`, value: at })),
    },
    '/marks',
  ],
  ['a mark without its value', { series: 'north', marks: [{ label: 'Goal' }] }, '/marks/0/value'],
];

function issueAt(pointer: string): unknown {
  return expect.objectContaining({ pointer });
}

describe('the prediction capability', () => {
  it('is the type prediction, written in Markdown, guided by prediction-function, with no facts of its own', () => {
    const { capability } = predictionRuns();

    expect([capability.type, capability.title, capability.mediaType, capability.guide, capability.noun]).toEqual([
      'prediction',
      'Prediction',
      'text/markdown',
      { name: 'prediction-function' },
      { one: 'prediction function', other: 'prediction functions' },
    ]);
    expect([
      capability.facts.onRuns,
      capability.facts.streams,
      capability.mostActive,
      predictionRuns(undefined, 3).capability.mostActive,
    ]).toEqual([[], [], 32, 3]);
  });
});

describe('a document the prediction capability refuses', () => {
  it('is refused naming how many problems it has', async () => {
    const refused = await Effect.runPromiseExit(
      predictionRuns().capability.prepare(
        weeklyOrdersWith(
          ['  horizons: [1, 4]', '  horizons: [4, 4]'],
          ['  unit: orders', '  unit: orders\n  coverage: 2'],
        ),
      ),
    );

    expect(refused).toMatchObject({
      cause: { reasons: [{ error: { detail: 'The prediction function definition has 2 problems' } }] },
    });
  });

  it('is refused naming each problem', async () => {
    const refused = await Effect.runPromiseExit(
      predictionRuns().capability.prepare(weeklyOrdersWith(['  horizons: [1, 4]', '  horizons: [4, 4]'])),
    );

    expect(refused).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The prediction function definition has a problem',
          issues: [
            {
              pointer: '',
              detail: 'Line 7, /predicts/horizons/1: The horizon 4 is named more than once; name each horizon once',
            },
          ],
        }),
      ),
    );
  });
});

describe('the summary of a prediction function', () => {
  it('derives the input of a question, answers a series, and keeps the data part for its dataset', () => {
    const { summary } = predictionRuns().prepared(weeklyOrders);

    expect(summary).toMatchObject({
      description: 'Predicts the orders of each region one and four weeks ahead',
      inputSchema: {
        title: 'question',
        required: ['series'],
        properties: {
          horizon: { type: 'integer', enum: [1, 4] },
          marks: { type: 'array', maxItems: 8 },
        },
      },
      details: { data: { period: 'week', events: [{ type: 'order.placed' }] }, shape: 'series' },
    });
    expect(summary.outputSchema).toBe(shapeNamed('series').schema);
  });

  it('has no description when its document has none', () => {
    const bare = weeklyOrdersWith(['description: Predicts the orders of each region one and four weeks ahead', '']);

    expect(predictionRuns().prepared(bare).summary.description).toBeUndefined();
  });
});

describe('a question to a prediction function whose dataset is not yet made', () => {
  it('is refused until its dataset is live', async () => {
    expect(await predictionRuns().running(weeklyOrders, question)).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            "The dataset is still being built from the playbook's history; ask again once get_definition shows it live",
          kind: 'dataset_not_ready',
        }),
      ),
    );
  });
});

describe('the input of a run of a prediction function', () => {
  it.each(questionsRefused)('is refused for a question with %s, naming where', async (_case, input, pointer) => {
    const failure = await predictionRuns().refusing(weeklyOrders, input);

    expect(failure).toBeInstanceOf(InvalidInput);
    expect(failure).toMatchObject({ issues: [issueAt(pointer)] });
  });

  it('is refused in the words of the fields of its question', async () => {
    const runs = predictionRuns();

    expect(
      await Promise.all(questionsRefused.map(async ([, input]) => (await runs.refusing(weeklyOrders, input)).detail)),
    ).toEqual([
      'series, The series, text of 1 to 256 bytes in UTF-8: expected at most 256 bytes in UTF-8, not 400.',
      'horizon, How many periods ahead of the last observed to predict; every horizon when left out: expected one of: 1, 4.',
      'The input: expected no field given.',
      'The input: expected the field series, The series, text of 1 to 256 bytes in UTF-8.',
      'marks, Values the answer carries as its marks, for display alone: expected at most 8 items.',
      'marks, then item 1: expected the field value.',
    ]);
  });

  it('is refused for an input that is no question', async () => {
    expect(await predictionRuns().refusing(weeklyOrders, 'north')).toMatchObject({ issues: [issueAt('')] });
  });

  it('is refused for an input nested past 512 levels', async () => {
    expect(await predictionRuns().refusing(weeklyOrders, { series: 'north', horizon: 1, deep })).toMatchObject({
      detail: 'The input nests more than the 512 levels a prediction function takes',
    });
  });
});

describe('how long a run of a prediction function lasts', () => {
  it('is 10 s within its call for any input, since the forecaster answers as it is asked', () => {
    const prepared = predictionRuns().prepared(weeklyOrders);

    expect([
      prepared.longestRunMs,
      prepared.longestRunMsFor(question),
      prepared.longestRunMsFor('anything'),
      prepared.finishesLaterFor(question),
      prepared.answersItsShapeFor(question),
    ]).toEqual([10_000, 10_000, 10_000, false, true]);
  });
});

describe('a run of a prediction function cancelled from outside while its call is in flight', () => {
  it('is refused, since a question takes place within its call', async () => {
    const playbook = cancelsInACall(predictionRuns().capability);
    await playbook.create('weekly-orders', weeklyOrders);

    const asked = await playbook.run('weekly-orders', question, '0199a3c4-7d2e-7c1a-9b3f-777777777771');

    expect(playbook.cancelled()).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
      },
    ]);
    expect(asked).toMatchObject({ status: 'rejected', reason: 'unavailable', kind: 'dataset_not_ready' });
  });
});
