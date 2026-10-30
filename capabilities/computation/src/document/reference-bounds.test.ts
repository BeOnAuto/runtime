import { readFileSync } from 'node:fs';

import { mostAssignmentsInAFunction } from '@on.auto/definitions/check';
import { describe, expect, it } from 'vitest';

import { computationBounds, mebibytes, mostOutputBytes } from '../run/run-bounds.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

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
      valueOf('Stack'),
      valueOf('Depth of a value'),
      valueOf('Output'),
      valueOf('Duration'),
      valueOf('Runs at once'),
    ]).toEqual([
      expect.stringContaining(`${counted.format(computationBounds.budget)} checkpoints`),
      expect.stringContaining(`${mostAssignmentsInAFunction} to variables in one function`),
      expect.stringContaining(`${computationBounds.memoryBytes / mebibytes} MiB`),
      expect.stringContaining(`${computationBounds.stackBytes / mebibytes} MiB`),
      expect.stringContaining(`${computationBounds.mostValueDepth} levels`),
      expect.stringContaining(`${counted.format(mostOutputBytes)} bytes`),
      expect.stringContaining(`${computationBounds.deadlineMs / 1000} seconds`),
      expect.stringContaining(`${computationBounds.workers} by default`),
    ]);
  });
});
