import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { sandboxAnswers } from '@on.auto/workflow-engine/dsl';
import { handedFileIn } from '@on.auto/workflow-engine/job-loop';
import type { CheckJob } from '@on.auto/workflow-engine/worker';
import { describe, expect, it } from 'vitest';

import { keptLibOnDisk } from '../testing/read-on-disk.ts';
import { handedChecks, keptLibFiles, sandboxLibFrom } from './kept-lib.ts';
import { sandboxLibOf } from './sandbox-lib.ts';

const kept = sandboxLibFrom(keptLibOnDisk);

const probe = (expressions: readonly string[]) => sandboxAnswers(shippedFilesOnDisk, expressions);

function computationReturning(output: string): CheckJob {
  return {
    module: {
      place: 'computation',
      source: `export default function (input: Input): Output {\n  return ${output};\n}`,
    },
    schemas: { input: { type: 'object' }, output: { type: 'array', items: { type: 'number' } } },
    expressions: [],
  };
}

function declares(text: string): (fragment: string) => boolean {
  return (fragment) => text.includes(fragment);
}

describe('the lib of the sandbox', () => {
  it('is what the generator makes from the compiler’s libs and the sandbox’s own answers, kept beside the package', async () => {
    expect(await sandboxLibOf(shippedFilesOnDisk, probe)).toEqual(kept);
    expect(keptLibFiles.script.pathname).toMatch(/\/definitions\/lib\/sandbox\.d\.ts\.txt$/u);
    expect(keptLibFiles.iterator.pathname).toMatch(/\/definitions\/lib\/sandbox-iterator\.d\.ts\.txt$/u);
  });

  it('declares nothing the prelude removes or the engine lacks, and what the engine has', () => {
    const has = declares(kept.script);

    expect(
      [
        'random(): number;',
        'declare function eval(',
        'declare var Function:',
        'declare var WeakRef:',
        'declare var FinalizationRegistry:',
        'getHours(): number;',
        'getTimezoneOffset(): number;',
        'toLocaleDateString(',
        'declare var Atomics:',
        '"$1": string;',
        'declare namespace Intl',
      ].filter((fragment) => has(fragment)),
    ).toEqual(['declare namespace Intl']);
    expect(
      [
        'toSorted(compareFn?:',
        'groupBy<K extends PropertyKey, T>(',
        'union<U>(other: ReadonlySetLike<U>): Set<T | U>;',
        'readonly description: string | undefined;',
        'cause?: unknown;',
        'declare var SharedArrayBuffer:',
        'getUTCHours(): number;',
      ].every((fragment) => has(fragment)),
    ).toBe(true);
    expect(kept.iterator).toContain('toArray(): T[];');
  });

  it('keeps the compiler’s notice once at the top of each file', () => {
    expect([kept.script, kept.iterator].map((text) => text.match(/Copyright \(c\) Microsoft/gu)?.length)).toEqual([
      1, 1,
    ]);
    expect(kept.script.startsWith('/*!')).toBe(true);
  });
});

describe('the checks of the worker the pool hands the kept lib', () => {
  it('answer the compiler’s issues against the sandbox’s lib, so a method the sandbox has checks and one it lacks does not', () => {
    const { check } = handedChecks(keptLibOnDisk);

    expect(check(computationReturning('[3, 1].toSorted()'))).toMatchObject({ ran: 'checked', issues: [] });
    expect(check(computationReturning('[Math.random()]'))).toMatchObject({
      ran: 'checked',
      issues: [{ at: 'module', line: 2, detail: "Property 'random' does not exist on type 'Math'." }],
    });
  });

  it('cannot be made when the pool handed the worker no kept lib', () => {
    expect(() => handedChecks(handedFileIn({}))).toThrow(
      `The pool handed this worker no file at ${keptLibFiles.script.href}`,
    );
  });
});
