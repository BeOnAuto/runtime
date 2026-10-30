import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormats, stateInCurrentFormat } from '../../index.ts';
import { runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const [, , , , , , , formatEight] = stateFormats.older;

const failedBranch = { type: 'runtime', status: 500, instance: '/do/1/fork/branches/2' };

const stateOfFormatEight = toJson(snapshotOf(runningState, 1).state);

const refusedField = {
  type: 'validation',
  status: 400,
  instance: '/do/1/fork/branches/2',
  issues: [{ pointer: '/input/seats', detail: 'seats, How many seats: expected at least 1.' }],
};

function withBranchError(error: Readonly<Record<string, unknown>>): Schema.Json {
  return toJson(
    JSON.parse(JSON.stringify(stateOfFormatEight).replace(JSON.stringify(failedBranch), JSON.stringify(error))),
  );
}

describe('a state of format 8', () => {
  it('is a state of format 9 as it is, whose errors name no issues', () => {
    expect(formatEight?.format).toBe(8);
    expect(stateInCurrentFormat(8, stateOfFormatEight)).toEqual(runningState);
  });

  it('is read strictly as format 8, so an error that names the issues of a refusal is refused before it is passed on', () => {
    expect(() => stateInCurrentFormat(8, withBranchError(refusedField))).toThrow(/issues/u);
    expect(stateInCurrentFormat(9, withBranchError(refusedField))).toMatchObject({
      machine: {
        root: {
          body: {
            list: { current: { task: { body: { branches: [{}, {}, { error: refusedField }] } } } },
          },
        },
      },
    });
  });
});
