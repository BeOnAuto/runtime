import { shapeNamed } from '@on.auto/definitions/testing';
import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { scriptedRuntimeThatFitsNothing } from '../runtime-testing/scripted-runtime.ts';
import { cancelsInACall } from '../testing/cancels-in-a-call.ts';
import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const question = { series: 'north', horizon: 4, given: { promotion: 1 } };

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 1);

const longestBuildMs = 604_800_000 + 8 * 600_000 + 60_000;

const pastItsBytes = { series: 'é'.repeat(200), horizon: 1, given: { promotion: 1 } };

const questionsRefused: readonly (readonly [string, Schema.JsonObject, string])[] = [
  ['a series of 200 characters past its 256 bytes', pastItsBytes, '/series'],
  ['a horizon it does not predict', { series: 'north', horizon: 2, given: { promotion: 1 } }, '/horizon'],
  ['a given name it does not list', { series: 'north', horizon: 1, given: { promotion: 1, price: 2 } }, '/given/price'],
  ['no series', { horizon: 1, given: { promotion: 1 } }, '/series'],
  [
    'nine marks',
    {
      series: 'north',
      given: { promotion: 1 },
      marks: Array.from({ length: 9 }, (_, at) => ({ label: `Mark ${at}`, value: at })),
    },
    '/marks',
  ],
  [
    'a mark without its value',
    { series: 'north', given: { promotion: 1 }, marks: [{ label: 'Goal' }] },
    '/marks/0/value',
  ],
];

function issueAt(pointer: string): unknown {
  return expect.objectContaining({ pointer });
}

describe('the prediction capability', () => {
  it('is the type prediction, written in Markdown, guided by prediction-function, with the facts of its builds and of its models', () => {
    const { capability } = predictionRuns();

    expect([capability.type, capability.title, capability.mediaType, capability.guide, capability.noun]).toEqual([
      'prediction',
      'Prediction',
      'text/markdown',
      { name: 'prediction-function' },
      { one: 'prediction function', other: 'prediction functions' },
    ]);
    expect([
      capability.facts.onRuns.map(({ type }) => type),
      capability.facts.streams.map(({ streamKind }) => streamKind),
      capability.mostActive,
      predictionRuns(undefined, 3).capability.mostActive,
    ]).toEqual([
      [
        'dataset_assembled',
        'candidate_uploaded',
        'candidate_refused',
        'candidate_scored',
        'candidate_disqualified',
        'baseline_scored',
        'baseline_not_walked',
        'candidates_fitted',
      ],
      ['models'],
      32,
      3,
    ]);
  });
});

describe('a document the prediction capability refuses', () => {
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
  it('derives the input of a question and of a build, answers a series, and keeps the data part for its dataset', () => {
    const { summary } = predictionRuns().prepared(weeklyOrders);

    expect(summary).toMatchObject({
      description: 'Predicts the orders of each region one and four weeks ahead',
      inputSchema: {
        oneOf: [
          {
            title: 'question',
            required: ['series', 'given'],
            properties: {
              horizon: { type: 'integer', enum: [1, 4] },
              given: { required: ['promotion'] },
              marks: { type: 'array', maxItems: 8 },
            },
          },
          { title: 'build', required: ['build'] },
        ],
      },
      details: { data_sha256: aDigest, data: { period: 'week', events: [{ type: 'order.placed' }] }, shape: 'series' },
    });
    expect(summary.outputSchema).toBe(shapeNamed('series').schema);
  });

  it('keeps in its details the interaction functions it calls: the one that sends a build, then the one that approves', () => {
    const throughBoth = weeklyOrdersWith(
      ['  activate: automatic', '  activate: { approved: approve-version }'],
      ['  expires: P7D', '  through: send-build\n  expires: P7D'],
    );

    expect(predictionRuns().prepared(throughBoth).summary.details).toMatchObject({
      calls: [
        { type: 'interaction', name: 'send-build', role: 'trainer' },
        { type: 'interaction', name: 'approve-version', role: 'approver' },
      ],
    });
    expect(predictionRuns().prepared(weeklyOrders).summary.details).not.toHaveProperty('calls');
  });

  it('has no description when its document has none', () => {
    const bare = weeklyOrdersWith(['description: Predicts the orders of each region one and four weeks ahead', '']);

    expect(predictionRuns().prepared(bare).summary.description).toBeUndefined();
  });
});

describe('a run of a prediction function before a version is built', () => {
  it('asks a question of the default forecast of a runtime that fits its own models, reading its window as any question does', async () => {
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

  it('refuses a question where no runtime of the server answers a function with no version, and says how to ask for a build', async () => {
    expect(
      await predictionRuns(undefined, undefined, [scriptedRuntimeThatFitsNothing]).running(weeklyOrders, question),
    ).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The function has no active version, and no model runtime this server has installed answers a function with none; ask for a build with the input { build: {} }',
          kind: 'no_active_version',
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
      'given, The value of each given feature for the periods ahead, by its name: expected no field price.',
      'The input: expected the field series, The series, text of 1 to 256 bytes in UTF-8.',
      'marks, Values the answer carries as its marks, for display alone: expected at most 8 items.',
      'marks, then item 1: expected the field value.',
    ]);
  });

  it('is refused for a build that carries anything, and for an input nested past 512 levels', async () => {
    const runs = predictionRuns();

    expect(await runs.refusing(weeklyOrders, { build: { now: true } })).toMatchObject({
      detail: 'build: expected no field now.',
    });
    expect(await runs.refusing(weeklyOrders, { series: 'north', horizon: 1, deep })).toMatchObject({
      detail: 'The input nests more than the 512 levels a prediction function takes',
    });
  });
});

describe('how long a run of a prediction function lasts', () => {
  it('is 10 s within its call for a question, and the expiry, eight candidates scored and its start for a build or an input it cannot tell', () => {
    const prepared = predictionRuns().prepared(weeklyOrders);

    expect([
      prepared.longestRunMs,
      prepared.longestRunMsFor(question),
      prepared.longestRunMsFor({ build: {} }),
    ]).toEqual([longestBuildMs, 10_000, longestBuildMs]);
    expect([prepared.finishesLaterFor(question), prepared.finishesLaterFor({ build: {} })]).toEqual([false, true]);
    expect([
      prepared.longestRunMsFor('anything'),
      prepared.finishesLaterFor({ series: 1 }),
      prepared.longestRunMsFor(pastItsBytes),
    ]).toEqual([longestBuildMs, true, longestBuildMs]);
  });
});

const questionRun = '0199a3c4-7d2e-7c1a-9b3f-777777777771';

const buildRun = '0199a3c4-7d2e-7c1a-9b3f-777777777772';

describe('a run of a prediction function cancelled from outside while its call is in flight', () => {
  it('is refused for a question, which takes place within its call, and taken for a build, which finishes later', async () => {
    const playbook = cancelsInACall(predictionRuns().capability);
    await playbook.create('weekly-orders', weeklyOrders);

    const asked = await playbook.run('weekly-orders', question, questionRun);
    const built = await playbook.run('weekly-orders', { build: {} }, buildRun);

    expect(playbook.cancelled()).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
      },
      expect.objectContaining({ status: 'succeeded' }),
    ]);
    expect([asked, built]).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'dataset_not_ready' },
      { status: 'rejected', reason: 'unavailable', kind: 'dataset_not_ready' },
    ]);
  });
});
