import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePredictionDocument } from '../document/document-parsing.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { dailyTotals, dailyVisits } from '../testing/daily-documents.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { candidateFilesOf, listedFormats } from './format-words.ts';
import { fedShapeOf, formatsAcceptedFor, modelRuntimePoint, runtimeFor, runtimeNamed } from './model-runtimes.ts';

const visits = Result.getOrThrow(parsePredictionDocument(dailyVisits));

const orders = Result.getOrThrow(parsePredictionDocument(weeklyOrders));

const totals = Result.getOrThrow(parsePredictionDocument(dailyTotals));

const takesNothing = { features: false, given: false, totals: false };

function runtimeOf(
  name: string,
  formats: readonly string[],
  capabilities = scriptedRuntime.capabilities,
): ModelRuntime {
  return { ...scriptedRuntime, name, formats, capabilities };
}

describe('the extension point of model runtimes', () => {
  it('is prediction/model-runtime, accepting contract 1, and takes a model runtime whose module is a file', () => {
    expect([modelRuntimePoint.name, modelRuntimePoint.contracts]).toEqual([
      'prediction/model-runtime',
      { least: 1, most: 1 },
    ]);
    expect(modelRuntimePoint.implementationOf(scriptedRuntime)).toEqual(Result.succeed(scriptedRuntime));
  });

  it('refuses what is not a model runtime, one whose module is not a file and one whose binding cannot name its module, in words', () => {
    const remote = {
      ...scriptedRuntime,
      binding: { kind: 'process', module: () => new URL('https://models.example.com/m.js') },
    };

    const unnamed = {
      ...scriptedRuntime,
      binding: {
        kind: 'process',
        module: () => {
          throw new Error('no module here\nat its stack');
        },
      },
    };

    expect([
      Result.isFailure(modelRuntimePoint.implementationOf({ name: 'half' })),
      modelRuntimePoint.implementationOf(remote),
      modelRuntimePoint.implementationOf(unnamed),
    ]).toEqual([
      true,
      Result.fail('The module its binding names is not a file'),
      Result.fail('Its binding could not name its module: no module here'),
    ]);
  });
});

describe('what a function feeds a model', () => {
  it('is the count of its features and of its given features, its longest horizon, and whether it predicts a total', () => {
    expect([fedShapeOf(visits), fedShapeOf(orders), fedShapeOf(totals)]).toEqual([
      { features: 0, given: 0, horizon: 2, totals: false },
      { features: 2, given: 1, horizon: 4, totals: false },
      { features: 0, given: 0, horizon: 7, totals: true },
    ]);
  });
});

describe('the runtimes a server has installed', () => {
  it('execute each format by the first runtime that names it, in the order the server loaded them', () => {
    const listed = runtimeOf('listed', ['graph', 'recipe']);
    const release = runtimeOf('release', ['graph']);

    expect([runtimeFor([listed, release], 'graph')?.name, runtimeFor([release, listed], 'graph')?.name]).toEqual([
      'listed',
      'release',
    ]);
    expect([runtimeFor([listed, release], 'recipe')?.name, runtimeFor([listed, release], 'csv')]).toEqual([
      'listed',
      undefined,
    ]);
  });

  it('accept for a function the formats whose runtime takes its features, its given features and its total', () => {
    const plain = runtimeOf('plain', ['plain'], takesNothing);
    const featured = runtimeOf('featured', ['featured'], { ...takesNothing, features: true });
    const given = runtimeOf('given', ['given'], { ...takesNothing, features: true, given: true });
    const totalled = runtimeOf('totalled', ['totalled'], { ...takesNothing, totals: true });
    const runtimes = [plain, featured, given, totalled];
    const formatsOf = (document: typeof visits) =>
      formatsAcceptedFor(runtimes, fedShapeOf(document)).map(({ format }) => format);

    expect([formatsOf(visits), formatsOf(orders), formatsOf(totals)]).toEqual([
      ['plain', 'featured', 'given', 'totalled'],
      ['given'],
      ['totalled'],
    ]);
    expect(runtimeNamed(given)).toEqual({ name: 'given', version: '1.0.0' });
  });
});

describe('the words of the formats a build takes', () => {
  it('list them, and say what an upload of a candidate takes', () => {
    expect([
      listedFormats([]),
      listedFormats(['a']),
      listedFormats(['a', 'b']),
      listedFormats(['a', 'b', 'c']),
    ]).toEqual(['', 'a', 'a or b', 'a, b or c']);
    expect([candidateFilesOf([]), candidateFilesOf(['graph']), candidateFilesOf(['graph', 'recipe'])]).toEqual([
      'nothing: no model runtime this server has installed executes a candidate for this function',
      'a file in the format graph',
      'a file in one of the formats graph or recipe, naming its format with ?format=',
    ]);
  });
});
