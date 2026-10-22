import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { answerOf, unchecked, type OutputIssue, type ProgramHost } from './program-answer.ts';
import type { ProgramJob } from './program-messages.ts';

async function hostOf(more: Partial<ProgramHost> = {}): Promise<ProgramHost> {
  return {
    now: () => 0,
    instance: await freshInstance(shippedFilesOnDisk, unitMemoryBytes),
    check: unchecked,
    ...more,
  };
}

const request: ProgramJob = {
  source: 'export default function (input) {\n  return input.map((item) => item + 1);\n}',
  entry: 'default',
  arguments: ['[1, 2]'],
  moment: 0,
  budget: 500,
  memoryBytes: unitMemoryBytes,
  stackBytes: threadStackBytes,
  deadlineAt: 10_000,
  mostOutputBytes: 1000,
  context: null,
};

function answeringAtMostTen(body: string): ProgramJob {
  return { ...request, source: `export default function () {\n  return ${body};\n}`, mostOutputBytes: 10 };
}

describe('the answer of a worker', () => {
  it('runs the program it is given on the arguments it is given', async () => {
    expect(answerOf(request, await hostOf())).toEqual({ ran: 'answered', output: '[2,3]', bytes: 5, work: 0 });
  });

  it('answers a program that does not load as refused, and a failure with its issue cut at 1,024 bytes', async () => {
    expect(answerOf({ ...request, source: 'export const x = 1;' }, await hostOf())).toEqual({
      ran: 'refused',
      issue: { detail: 'The program exports no function default', line: null },
    });
    expect(
      answerOf(
        { ...request, source: 'export default function () {\n  throw new Error("x".repeat(3000));\n}' },
        await hostOf(),
      ),
    ).toEqual({ ran: 'raised', issue: { detail: `Error: ${'x'.repeat(1017)}…`, line: 2 }, work: 0 });
  });

  it('answers an output larger than it may give as oversized, in characters in the sandbox and in bytes outside it', async () => {
    expect(answerOf(answeringAtMostTen('"x".repeat(20)'), await hostOf())).toEqual({ ran: 'oversized', work: 0 });
    expect(answerOf(answeringAtMostTen('"é".repeat(5)'), await hostOf())).toEqual({ ran: 'oversized', work: 0 });
  });
});

function refusing(output: unknown): readonly OutputIssue[] {
  return [
    { pointer: `/${'k'.repeat(2000)}`, detail: 'Expected no excess property' },
    { pointer: '', detail: `got ${JSON.stringify(output)} ${'x'.repeat(2000)}` },
  ];
}

describe('the answer of a worker that checks the output', () => {
  it('answers the output when the check finds nothing, and the issues it finds when it does, the pointer and the detail of each cut at 1,024 bytes apart', async () => {
    expect(answerOf(request, await hostOf())).toMatchObject({ ran: 'answered', output: '[2,3]' });
    expect(answerOf(request, await hostOf({ check: refusing }))).toEqual({
      ran: 'mismatched',
      issues: [
        { pointer: `/${'k'.repeat(1023)}…`, detail: 'Expected no excess property' },
        { pointer: '', detail: `got [2,3] ${'x'.repeat(1014)}…` },
      ],
      work: 0,
    });
  });
});
