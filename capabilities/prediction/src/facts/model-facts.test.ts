import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { ModelFactSchema } from './model-facts.ts';

const ofTheDefinition = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'runtime',
  definitionType: 'prediction',
  definitionName: 'weekly-orders',
  definitionVersion: 3,
};

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const runtime = { name: 'onnx', version: '1.23.0' };

const score = { horizon: 4, pairs: 120, mase: 0.82, winkler: 14.5, quantile: 3.1 };

const verdict = { version: 2, build: 'build-2', metric: 'mase', challenger: 0.78, active: 0.82, ungraded_closes: 1 };

const baseline: readonly (typeof ModelFactSchema.Type)[] = [
  {
    type: 'version_built',
    data: {
      version: 2,
      build: 'build-2',
      trained_by: caller,
      dataset: {
        data_sha256: 'a1b2c3',
        training_sha256: 'd4e5f6',
        scoring_sha256: 'a7b8c9',
        rows: 520,
        series: 10,
        series_left_out: 1,
        first_period: '2025-11-03',
        last_period: '2026-10-26',
        window: 26,
        holdout: 4,
        checkpoint: null,
      },
      file: { sha256: 'b1c2d3', bytes: 65_536, format: 'onnx', runtime },
      signature: { inputs: ['x'], outputs: ['q'] },
      features: ['orders', 'week'],
      given: ['week'],
      scores: [score],
      coverage: 0.9,
      against: [{ baseline: 'persistence', p_better: 0.99 }],
      baselines: [
        { baseline: 'persistence', scores: [score], coverage: 0.8, series_walked: 9 },
        { baseline: 'seasonal-naive', series_walked: 0 },
      ],
      rule: 'approved',
      recipe_sha256: 'c1d2e3',
      recipe_bytes: 2048,
      limitations_sha256: 'f4a5b6',
      limitations_bytes: 512,
      features_sha256: 'c7d8e9',
      features_bytes: 256,
    },
    context: ofTheDefinition,
  },
  {
    type: 'shadow_predicted',
    data: {
      version: 2,
      of: 1,
      build: 'build-2',
      runtime,
      origin: '2026-10-26',
      count: 40,
      missing: 0,
      predictions_sha256: 'e1f2a3',
      predictions_bytes: 4096,
    },
    context: ofTheDefinition,
  },
  {
    type: 'shadow_graded',
    data: {
      version: 2,
      of: 1,
      build: 'build-2',
      period: '2026-11-02',
      scores: [score],
      graded: 10,
      answered: 10,
      missing: 0,
    },
    context: ofTheDefinition,
  },
  { type: 'shadow_passed', data: verdict, context: ofTheDefinition },
  { type: 'shadow_failed', data: { ...verdict, challenger: null }, context: ofTheDefinition },
  {
    type: 'version_activated',
    data: {
      version: 2,
      definition_version: 3,
      data_sha256: 'a1b2c3',
      file_sha256: 'b1c2d3',
      file_format: 'onnx',
      rule: 'approved',
      approved_by: caller,
      build: 'build-2',
    },
    context: ofTheDefinition,
  },
  {
    type: 'activation_refused',
    data: { version: 3, because: 'approver_rejected', refused_by: caller, build: 'build-3' },
    context: ofTheDefinition,
  },
  {
    type: 'build_asked',
    data: { build: 'build-4', asked_at: '2026-10-29T09:00:00.000Z' },
    context: ofTheDefinition,
  },
  { type: 'build_ended', data: { build: 'build-4' }, context: ofTheDefinition },
];

describe('the facts of the models of a prediction function', () => {
  recordedFactsBehaviour({
    schema: ModelFactSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
