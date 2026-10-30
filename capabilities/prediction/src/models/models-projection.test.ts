import type { Context, ProjectedRow } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { modelsRowOf, predictionModels } from './models-projection.ts';

const context: Context = {
  at: '2026-10-13T09:00:00.000Z',
  by: 'playbook:alpha',
  definitionType: 'prediction',
  definitionName: 'daily-visits',
  definitionVersion: 1,
};

function after(row: ProjectedRow, type: string, data: object): ProjectedRow | undefined {
  return predictionModels.rowAfter(row, { id: 'fact-1', position: 1, type, data, context });
}

const challenged: ProjectedRow = {
  active: 1,
  active_data_sha256: null,
  active_file_sha256: null,
  active_file_format: null,
  active_definition_version: 1,
  latest: 3,
  versions: 3,
  challenger: 3,
  challenger_build: 'build-3',
  shadow_predicted: 0,
  shadow_graded: 0,
  shadow: null,
};

const verdict = { build: 'build-1', metric: 'mase', challenger: 0.5, active: 0.75 };

describe('the models row of a prediction function', () => {
  it('takes the verdict of the version in its shadow, and none of a version superseded before its verdict', () => {
    expect([
      modelsRowOf(after(challenged, 'shadow_passed', { ...verdict, version: 2 })).shadow,
      modelsRowOf(after(challenged, 'shadow_failed', { ...verdict, version: 3 })).shadow,
    ]).toEqual([null, 'failed']);
  });
});
