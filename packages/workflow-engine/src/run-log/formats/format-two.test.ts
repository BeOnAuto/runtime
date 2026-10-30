import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormats, stateInCurrentFormat } from '../../index.ts';
import { beforeFormatFive, runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const [, formatTwo] = stateFormats.older;

const failedBranch = { type: 'runtime', status: 500, instance: '/do/1/fork/branches/2' };

const stateOfFormatTwo = toJson(
  JSON.parse(
    JSON.stringify(beforeFormatFive(snapshotOf(runningState, 1).state)).replaceAll('"runId":', '"executionId":'),
  ),
);

function withBranchError(error: Readonly<Record<string, unknown>>): Schema.Json {
  return toJson(
    JSON.parse(JSON.stringify(stateOfFormatTwo).replace(JSON.stringify(failedBranch), JSON.stringify(error))),
  );
}

describe('a state of format 2', () => {
  it('is a state of format 3 as it is, whose errors have no kind and no because', () => {
    expect(formatTwo?.format).toBe(2);
    expect(stateInCurrentFormat(2, stateOfFormatTwo)).toEqual(runningState);
  });

  it('is read strictly as format 2, so an error with a kind is refused before it is passed on', () => {
    expect(() => stateInCurrentFormat(2, withBranchError({ ...failedBranch, kind: 'tools_unfinished' }))).toThrow(
      /kind/u,
    );
    expect(stateInCurrentFormat(3, withBranchError({ ...failedBranch, kind: 'tools_unfinished' }))).toMatchObject({
      machine: {
        root: {
          body: {
            list: { current: { task: { body: { branches: [{}, {}, { error: { kind: 'tools_unfinished' } }] } } } },
          },
        },
      },
    });
  });
});
