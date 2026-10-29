import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePredictionDocument } from '../document/document-parsing.ts';
import {
  inlineScriptedRuntime,
  scriptedFeaturesOf,
  licensedScriptedRuntime,
  scriptedFeature,
  scriptedRuntime,
} from '../runtime-testing/scripted-runtime.ts';
import { dailyTotals, dailyVisits } from '../testing/daily-documents.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { candidateFilesOf, listedFormats } from './format-words.ts';
import {
  fedShapeOf,
  fittingRuntimeFor,
  formatsAcceptedFor,
  formatsOfferedFor,
  modelRuntimePoint,
  runtimeFor,
  runtimeNamed,
  unlicensedFeatureOf,
} from './model-runtimes.ts';

const visits = Result.getOrThrow(parsePredictionDocument(dailyVisits));

const orders = Result.getOrThrow(parsePredictionDocument(weeklyOrders));

const totals = Result.getOrThrow(parsePredictionDocument(dailyTotals));

const unlicensed = scriptedFeaturesOf({ features: [] });

const licensed = scriptedFeaturesOf({ features: [scriptedFeature] });

function named({ format, runtime }: { readonly format: string; readonly runtime: ModelRuntime }): readonly string[] {
  return [format, runtime.name];
}

const takesNothing = { features: false, given: false, totals: false };

function runtimeOf(
  name: string,
  formats: readonly string[],
  capabilities = scriptedRuntime.capabilities,
): ModelRuntime {
  return { ...scriptedRuntime, name, formats, capabilities };
}

describe('the extension point of model runtimes', () => {
  it('is prediction/model-runtime, accepting contracts 1 to 3, and takes a model runtime whose module is a file', () => {
    expect([modelRuntimePoint.name, modelRuntimePoint.contracts]).toEqual([
      'prediction/model-runtime',
      { least: 1, most: 3 },
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

describe('the model runtimes only the release may provide', () => {
  it("are those bound inline, into the server's own process, since an extension's runtime runs in a model process", () => {
    expect([
      modelRuntimePoint.reservedForTheRelease?.(inlineScriptedRuntime),
      modelRuntimePoint.reservedForTheRelease?.(scriptedRuntime),
    ]).toEqual([
      "it binds the model runtime inline-scripted-runtime inline, into the server's own process, which only the release's own extensions may: an extension's runtime runs in a model process, so its binding is a process",
      undefined,
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
      Effect.runSync(formatsAcceptedFor({ runtimes, features: unlicensed, org: 'acme' }, fedShapeOf(document))).map(
        ({ format }) => format,
      );

    expect([formatsOf(visits), formatsOf(orders), formatsOf(totals)]).toEqual([
      ['plain', 'featured', 'given', 'totalled'],
      ['given'],
      ['totalled'],
    ]);
    expect(runtimeNamed(given)).toEqual({ name: 'given', version: '1.0.0' });
  });
});

describe('the runtimes whose work needs a feature of the license', () => {
  it('offer their formats while the license includes it, and set them apart while it does not', () => {
    const runtimes = [licensedScriptedRuntime, scriptedRuntime];
    const offered = (features: typeof licensed) =>
      Effect.runSync(formatsOfferedFor({ runtimes, features, org: 'acme' }, fedShapeOf(visits)));

    expect([offered(licensed).accepted.map(named), offered(licensed).unlicensed]).toEqual([
      [
        ['scripted-licensed', 'licensed-scripted-runtime'],
        ['scripted', 'scripted-runtime'],
      ],
      [],
    ]);
    expect(offered(unlicensed)).toEqual({
      accepted: [{ format: 'scripted', runtime: scriptedRuntime }],
      unlicensed: [{ format: 'scripted-licensed', runtime: licensedScriptedRuntime, feature: scriptedFeature }],
    });
  });

  it('fit a function’s models only while the license includes their feature, the next runtime that fits doing so meanwhile', () => {
    const runtimes = [licensedScriptedRuntime, scriptedRuntime];
    const fitting = (features: typeof licensed) =>
      Effect.runSync(fittingRuntimeFor({ runtimes, features, org: 'acme' }, fedShapeOf(visits)))?.name;

    expect([fitting(licensed), fitting(unlicensed)]).toEqual(['licensed-scripted-runtime', 'scripted-runtime']);
  });

  it('name the feature the license lacks, and a runtime that names none never lacks one', () => {
    const lacking = (features: typeof licensed, runtime: ModelRuntime) =>
      Effect.runSync(unlicensedFeatureOf({ features, org: 'acme' }, runtime));

    expect([
      lacking(unlicensed, licensedScriptedRuntime),
      lacking(licensed, licensedScriptedRuntime),
      lacking(unlicensed, scriptedRuntime),
    ]).toEqual([scriptedFeature, undefined, undefined]);
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
