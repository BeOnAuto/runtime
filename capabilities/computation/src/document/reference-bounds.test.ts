import { readFileSync } from 'node:fs';

import { mostResultBytes } from '@on.auto/definitions';
import { mostAssignmentsInAFunction } from '@on.auto/definitions/check';
import { pollsPerCheckpoint } from '@on.auto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { computationBounds, mebibytes } from '../run/run-bounds.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the bounds on the public reference page of computation functions', () => {
  it('are the bounds the code holds a run to', () => {
    expect([
      valueOf('Work'),
      valueOf('Assignments'),
      valueOf('Memory'),
      valueOf('Depth of a value'),
      valueOf('Output'),
      valueOf('Duration'),
      valueOf('Runs at once'),
    ]).toEqual([
      expect.stringContaining(`About ${(computationBounds.budget * pollsPerCheckpoint) / 1_000_000} million steps`),
      expect.stringContaining(`${mostAssignmentsInAFunction} to variables in one function`),
      expect.stringContaining(`${computationBounds.memoryBytes / mebibytes} MiB`),
      expect.stringContaining(`${computationBounds.mostValueDepth} levels`),
      expect.stringContaining(`About ${mostResultBytes / mebibytes} MiB as JSON`),
      expect.stringContaining(`${computationBounds.deadlineMs / 1000} seconds`),
      expect.stringContaining(`within its ${computationBounds.deadlineMs / 1000} seconds`),
    ]);
  });
});
