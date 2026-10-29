import type { RecordedWork } from '@on.auto/definitions';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe, expect, it } from 'vitest';

import { BuildFactSchema, buildWorkIn } from './build-facts.ts';

const onTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'runtime',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'prediction',
  definitionName: 'weekly-orders',
  definitionVersion: 3,
};

const runtime = { name: 'onnx', version: '1.23.0' };

const score = { horizon: 4, pairs: 120, mase: 0.82, winkler: 14.5, quantile: 3.1 };

const baseline: readonly (typeof BuildFactSchema.Type)[] = [
  {
    type: 'dataset_assembled',
    data: {
      data_sha256: 'a1b2c3',
      training_sha256: 'd4e5f6',
      training_bytes: 40_960,
      scoring_sha256: 'a7b8c9',
      scoring_bytes: 8192,
      rows: 520,
      series: 10,
      series_left_out: 1,
      first_period: '2025-11-03',
      last_period: '2026-10-26',
      window: 26,
      holdout: 4,
      checkpoint: '0/120',
    },
    context: onTheRun,
  },
  {
    type: 'candidate_uploaded',
    data: {
      sha256: 'b1c2d3',
      bytes: 65_536,
      format: 'onnx',
      runtime,
      signature: { inputs: ['x'], outputs: ['q'] },
    },
    context: onTheRun,
  },
  {
    type: 'candidate_refused',
    data: { sha256: 'e4f5a6', bytes: 1024, because: 'wrong_signature', detail: 'The model takes no input x' },
    context: onTheRun,
  },
  {
    type: 'candidate_scored',
    data: {
      sha256: 'b1c2d3',
      runtime,
      scores: [score],
      coverage: 0.9,
      against: [{ baseline: 'seasonal-naive', p_better: 0.97 }],
      duration_ms: 3400,
    },
    context: onTheRun,
  },
  {
    type: 'candidate_disqualified',
    data: { sha256: 'c7d8e9', because: 'not_better', detail: 'It scores no better than the baselines' },
    context: onTheRun,
  },
  {
    type: 'baseline_scored',
    data: { baseline: 'persistence', scores: [score], coverage: null, series_walked: 9 },
    context: onTheRun,
  },
  {
    type: 'baseline_not_walked',
    data: { baseline: 'seasonal-naive', because: 'too_short' },
    context: onTheRun,
  },
  {
    type: 'candidates_fitted',
    data: { runtime, candidates: ['b1c2d3'], detail: 'One candidate was fitted' },
    context: onTheRun,
  },
];

describe('the facts a prediction function records on the run of a build', () => {
  recordedFactsBehaviour({
    schema: BuildFactSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});

describe('the build facts a prediction function reads from the work of its run', () => {
  it('are its own, each in a shape it reads, and none of the work another capability records', () => {
    const work = baseline.map(({ type, data }): RecordedWork => ({ type, data: { ...data }, context: onTheRun }));

    expect([
      ...work.flatMap((each) => buildWorkIn(each)),
      ...buildWorkIn({ type: 'nudge_sent', data: { number: 1 }, context: onTheRun }),
    ]).toEqual(baseline);
  });

  it('refuses one of its own in a shape no reader of it knows, as any unreadable fact of the run', () => {
    expect(() =>
      buildWorkIn({ type: 'candidate_uploaded', data: { sha256: 'a'.repeat(64) }, context: onTheRun }),
    ).toThrow('Missing key');
  });
});
