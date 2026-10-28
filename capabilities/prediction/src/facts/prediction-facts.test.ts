import type { Context, KeptContent, RecordedFact } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { predictionFacts } from './prediction-facts.ts';

const at = '2026-10-12T09:00:00.000Z';

const sha256 = 'a1b2c3d4e5f6'.padEnd(64, '0');

const score = { horizon: 1, pairs: 4, mase: 0.75, winkler: 3.5, quantile: 1.25 };

const runtime = { name: 'scripted-runtime', version: '1.0.0' };

const inTheRun = {
  at,
  by: 'playbook:alpha',
  runId: 'run-1',
  definitionType: 'prediction',
  definitionName: 'daily-visits',
  definitionVersion: 1,
};

const ofTheFunction = {
  at,
  by: 'playbook:alpha',
  definitionType: 'prediction',
  definitionName: 'daily-visits',
  definitionVersion: 1,
};

function recorded(type: string, data: Schema.JsonObject, context: Context): RecordedFact {
  return {
    id: 'event-1',
    causationId: null,
    correlationId: null,
    stream: 'runs/run-1',
    version: 1,
    globalPosition: 9,
    recordedAt: at,
    type,
    data,
    context,
  };
}

function buildSummary(type: string, data: Schema.JsonObject): string {
  const declared = predictionFacts.onRuns.find((fact) => fact.type === type);
  return String(declared?.present(recorded(type, data, inTheRun), nothingKept).summary);
}

function modelPresented(type: string, data: Schema.JsonObject, content: KeptContent = nothingKept) {
  const [presenter] = predictionFacts.streams;
  return presenter?.present(recorded(type, data, ofTheFunction), content);
}

const assembled = {
  data_sha256: sha256,
  training_sha256: sha256,
  training_bytes: 900,
  scoring_sha256: sha256,
  scoring_bytes: 1000,
  rows: 1200,
  series: 3,
  series_left_out: 0,
  first_period: '2026-09-01',
  last_period: '2026-10-10',
  window: 40,
  holdout: 7,
  checkpoint: null,
};

const { training_bytes: _training, scoring_bytes: _scoring, ...cardDataset } = assembled;

const card = {
  version: 1,
  build: 'run-1',
  trained_by: { id: 'acme-trainer', name: 'acme-trainer' },
  dataset: cardDataset,
  file: { sha256, bytes: 600, format: 'scripted', runtime },
  signature: { recipe: 'mean' },
  scores: [score],
  coverage: 0.8,
  against: [],
  baselines: [],
  rule: 'automatic',
  recipe_sha256: 'r'.repeat(64),
  recipe_bytes: 12,
};

const keptRecipe: KeptContent = (digest) => ({ ['r'.repeat(64)]: 'Gradient boosting on lags' })[digest];

const verdict = { version: 2, build: 'run-2', metric: 'mase', challenger: 0.5, active: 0.75 };

const buildFacts: readonly (readonly [string, Schema.JsonObject, string])[] = [
  [
    'dataset_assembled',
    assembled,
    "The dataset was read into the build's two files: 1,200 rows of 3 series from 2026-09-01 to 2026-10-10, the last 7 periods held back from the trainer",
  ],
  [
    'candidate_uploaded',
    { sha256, bytes: 600, format: 'scripted', runtime, signature: { recipe: 'mean' } },
    'Candidate a1b2c3d4e5f6… was uploaded, 600 bytes in the format scripted, which scripted-runtime 1.0.0 checked',
  ],
  [
    'candidate_refused',
    { sha256, bytes: 600, because: 'wrong_signature', detail: 'No y' },
    'Candidate a1b2c3d4e5f6… was refused: its inputs or outputs are not the signature the playbook feeds',
  ],
  [
    'candidate_scored',
    {
      sha256,
      runtime,
      scores: [score, { ...score, horizon: 2, mase: 1.5 }],
      coverage: 0.8,
      against: [],
      duration_ms: 40,
    },
    'Candidate a1b2c3d4e5f6… was scored on the held-back periods: mase 1.125 over its horizons, its interval holding 0.8 of the truths',
  ],
  [
    'candidate_scored',
    { sha256, runtime, scores: [{ ...score, mase: null }], coverage: null, against: [], duration_ms: 40 },
    'Candidate a1b2c3d4e5f6… was scored on the held-back periods: no mase over its horizons, its interval holding none of the truths',
  ],
  [
    'candidate_disqualified',
    { sha256, because: 'not_better' },
    'Candidate a1b2c3d4e5f6… was disqualified: it did not beat every baseline with the confidence asked',
  ],
  [
    'baseline_scored',
    { baseline: 'persistence', scores: [score], coverage: 0.7, series_walked: 3 },
    'The baseline persistence was walked over 3 series: mase 0.75',
  ],
  [
    'baseline_not_walked',
    { baseline: 'seasonal-naive', because: 'too_short' },
    'The baseline seasonal-naive could not be walked: no series had a season observed before an origin',
  ],
];

describe('the facts of a build, as a run shows them', () => {
  it.each(buildFacts)('says what %s means', (type, data, summary) => {
    expect(buildSummary(type, data)).toBe(summary);
  });
});

const modelFacts: readonly (readonly [string, Schema.JsonObject, string])[] = [
  ['version_built', card, 'Version 1 of the model was built from candidate a1b2c3d4e5f6…'],
  [
    'shadow_predicted',
    {
      version: 2,
      of: 1,
      build: 'run-2',
      runtime,
      origin: '2026-10-11',
      count: 3,
      missing: 1,
      predictions_sha256: sha256,
      predictions_bytes: 90,
    },
    'Version 1 predicted 3 series from 2026-10-11 in the shadow of version 2, and 1 whose answer was not finite or had a low above its likely value or a high below it',
  ],
  [
    'shadow_graded',
    { version: 2, of: 2, build: 'run-2', period: '2026-10-12', scores: [score], graded: 3, answered: 4, missing: 1 },
    "The shadow predictions of version 2 for 2026-10-12 were graded: 3 graded beside the other version's, of 4 it answered, 1 without an answer or a truth",
  ],
  ['shadow_passed', verdict, 'The shadow passed for version 2, mase 0.5 against 0.75 of the active version'],
  [
    'shadow_failed',
    { ...verdict, active: null },
    'The shadow failed for version 2, with no active version graded beside it',
  ],
  [
    'shadow_failed',
    { ...verdict, challenger: null, active: null, ungraded_closes: 52 },
    'The shadow failed for version 2: none of its 52 closes graded a series both versions predicted',
  ],
  [
    'version_activated',
    {
      version: 2,
      definition_version: 1,
      data_sha256: sha256,
      file_sha256: sha256,
      file_format: 'scripted',
      rule: 'approved',
      approved_by: { id: 'ada', name: 'ada' },
      build: 'run-2',
    },
    'Version 2 of the model was activated as its approver approved',
  ],
  [
    'activation_refused',
    { version: 2, because: 'shadow_failed', build: 'run-2' },
    'Version 2 of the model was not activated: it did not pass its shadow beside the active version',
  ],
  [
    'activation_refused',
    { version: 2, because: 'superseded', build: 'run-2' },
    'Version 2 of the model was not activated: a newer version was built while it waited',
  ],
  ['build_asked', { build: 'run-3', asked_at: '2026-10-13T08:00:00.000Z' }, 'Build run-3 of the function was asked'],
  ['build_ended', { build: 'run-3' }, 'Build run-3 of the function ended'],
];

describe('the facts of the models of a function, as its stream shows them', () => {
  it.each(modelFacts)('says what %s means', (type, data, summary) => {
    expect(modelPresented(type, data)).toMatchObject([{ type, summary }]);
  });

  it('shows the recipe and the limitations a trainer gave a version beside their digests, when they are kept', () => {
    expect(modelPresented('version_built', { ...card, limitations_sha256: 'l'.repeat(64) }, keptRecipe)).toMatchObject([
      {
        data: {
          recipe_sha256: 'r'.repeat(64),
          recipe: 'Gradient boosting on lags',
          limitations_sha256: 'l'.repeat(64),
        },
      },
    ]);
  });

  it('names its stream kind and the public name of each fact', () => {
    const [presenter] = predictionFacts.streams;

    expect([presenter?.streamKind, presenter?.publicNames['version_activated']]).toEqual([
      'models',
      ['version_activated'],
    ]);
  });
});
