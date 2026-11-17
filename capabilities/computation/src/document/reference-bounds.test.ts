import { readFileSync } from 'node:fs';

import { mostResultBytes } from '@on.auto/definitions';
import { mostAssignmentsInAFunction } from '@on.auto/definitions/check';
import { pollsPerCheckpoint } from '@on.auto/workflow-engine/dsl';
import { Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { computationBounds, mebibytes } from '../run/run-bounds.ts';
import { computationWith, functionOf, programDocument } from '../testing/computation-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

const deepest = [
  'let deepest = 0;',
  '  const down = (depth: number): number => {',
  '    deepest = depth;',
  '    return down(depth + 1);',
  '  };',
  '  try {',
  '    down(0);',
  '  } catch (error) {',
  '    return [deepest, String(error)];',
  '  }',
  '  return -1;',
].join('\n');

const thousand = 1000;

const decodedAnswer = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Tuple([Schema.Number, Schema.String]) }));

function depthOn(line: string): number {
  return Number(/About (?<depth>[\d,]+) calls deep/u.exec(line)?.groups?.['depth']?.replaceAll(',', ''));
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

  it('give the depth a function that calls itself reaches in a run, in whole thousands, the same every time', async () => {
    const ran = await computationWith().running(programDocument(functionOf(deepest)), null);
    const {
      output: [reached, error],
    } = decodedAnswer(Exit.match(ran, { onSuccess: (answer) => answer, onFailure: () => null }));

    expect([Math.floor(reached / thousand) * thousand, error]).toEqual([
      depthOn(valueOf('Stack')),
      'InternalError: stack overflow',
    ]);
  });
});
