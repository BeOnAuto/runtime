import type { CheckJob } from '@on.auto/workflow-engine/worker';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptLibOnDisk } from '../testing/read-on-disk.ts';
import { fewerAssignments, mostAssignmentsInAFunction } from './assignment-bound.ts';
import { checkerOf } from './checking.ts';
import { sandboxLibFrom } from './kept-lib.ts';

const check = checkerOf(sandboxLibFrom(keptLibOnDisk));

const output: Schema.JsonObject = {
  type: 'object',
  required: ['total'],
  properties: { total: { type: 'number' } },
};

function assigning(times: number, helper = ''): string {
  return [
    'export default function (input: Input): Output {',
    helper,
    '  let total = 0;',
    ...Array.from({ length: times }, (_, index) => (index % 2 === 0 ? `  total += ${index};` : '  total++;')),
    '  return { total };',
    '}',
  ].join('\n');
}

function issuesOf(job: CheckJob): readonly (readonly [number | 'module', number, string])[] {
  const answer = check(job);
  return answer.ran === 'checked' ? answer.issues.map(({ at, line, detail }) => [at, line, detail] as const) : [];
}

function computation(source: string): CheckJob {
  return { module: { place: 'computation', source }, schemas: { output }, expressions: [] };
}

describe('the assignments of one function', () => {
  it('are refused past 500, at the first past it, before the compiler analyses them', () => {
    expect(mostAssignmentsInAFunction).toBe(500);
    expect(issuesOf(computation(assigning(500)))).toEqual([]);
    expect(issuesOf(computation(assigning(501)))).toEqual([['module', 504, fewerAssignments]]);
    expect(issuesOf(computation(assigning(2150)))).toEqual([['module', 504, fewerAssignments]]);
  });

  it('are counted in each function apart, a nested one with its own', () => {
    const helper = `  const step = (): number => {\n    let kept = 0;\n${'    kept += 1;\n'.repeat(400)}    return kept;\n  };`;

    expect(issuesOf(computation(assigning(400, helper)))).toEqual([]);
  });

  it('of an expression are refused the same way, with no other expression of the document analysed', () => {
    const many = `(() => {\n  let total = 0;\n${'  total += $data.n;\n'.repeat(501)}  return total;\n})()`;

    expect(
      issuesOf({
        schemas: {},
        expressions: [
          { source: many, names: ['$data'] },
          { source: '$nope', names: ['$data'] },
        ],
      }),
    ).toEqual([[0, 503, fewerAssignments]]);
  });
});
