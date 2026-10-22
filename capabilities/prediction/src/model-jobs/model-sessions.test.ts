import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { candidateUrl, type CandidateName } from '../build-testing/due-driving.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import {
  AnsweredBadly,
  firstLineOf,
  lengthOf,
  loadWithOnnxRuntime,
  rethrownNamingAllocation,
  type ModelFeeds,
} from './model-sessions.ts';

function loaded(name: CandidateName) {
  return loadWithOnnxRuntime(fileURLToPath(candidateUrl(name)), 1);
}

const twoDays: ModelFeeds = { y: { data: Float32Array.of(10, 12), dims: [1, 2] } };

interface LoadedInAProcess {
  readonly exited: readonly unknown[];
  readonly leftInItsTemporaryFolder: readonly string[];
}

async function loadedInAProcessOfItsOwn(name: CandidateName): Promise<LoadedInAProcess> {
  const temporaryFolder = scratchDirectory();
  const loading = [
    `import { loadWithOnnxRuntime } from ${JSON.stringify(new URL('./model-sessions.ts', import.meta.url).href)};`,
    `await loadWithOnnxRuntime(${JSON.stringify(fileURLToPath(candidateUrl(name)))}, 1);`,
  ].join('\n');
  const child = spawnForTheTest(process.execPath, ['--input-type=module', '--eval', loading], {
    env: { TMPDIR: temporaryFolder },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited: readonly unknown[] = await once(child, 'exit');
  return { exited, leftInItsTemporaryFolder: readdirSync(temporaryFolder) };
}

describe('a model loaded in onnxruntime', () => {
  it('names its inputs and outputs with their types and axes, and the periods of y when its signature fixes them', async () => {
    const [mean, week, sequence] = await Promise.all([
      loaded('visits-mean'),
      loaded('visits-week'),
      loaded('visits-sequence'),
    ]);

    expect([mean.inputs, mean.outputs, mean.length, week.length]).toEqual([
      [{ name: 'y', type: 'float32', shape: [1, 'L'] }],
      [{ name: 'q', type: 'float32', shape: [1, 2, 3] }],
      undefined,
      7,
    ]);
    expect(sequence.outputs).toEqual([{ name: 'q', type: 'non-tensor', shape: [] }]);
  });

  it('turns the telemetry of onnxruntime off first, so the process it is loaded in leaves nothing in its temporary folder', async () => {
    expect(await loadedInAProcessOfItsOwn('visits-mean')).toEqual({ exited: [0, null], leftInItsTemporaryFolder: [] });
  });

  it('answers q as float32 with its dimensions', async () => {
    const answer = await (await loaded('visits-mean')).run(twoDays);

    expect([[...answer.data], answer.dims]).toEqual([
      [9, 11, 13, 9, 11, 13],
      [1, 2, 3],
    ]);
  });

  it('takes h as int64 when it predicts a total', async () => {
    const answer = await (
      await loaded('totals-run-rate')
    ).run({
      y: { data: new Float32Array(14).fill(10), dims: [1, 14] },
      h: { data: BigInt64Array.of(2n), dims: [1] },
    });

    expect([[...answer.data], answer.dims]).toEqual([
      [16, 20, 24],
      [1, 1, 3],
    ]);
  });
});

describe('a model loaded in onnxruntime that does not answer', () => {
  it('answers badly when q is not float32, and passes on what the runtime refuses', async () => {
    await expect((await loaded('visits-whole-numbers')).run(twoDays)).rejects.toThrow(
      new AnsweredBadly('The model answered no q of float32'),
    );
    await expect((await loaded('visits-mean')).run({})).rejects.toThrow(/input 'y' is missing/u);
  });

  it('is not loaded from a file that is not a model', async () => {
    await expect(loaded('not-a-model')).rejects.toThrow(/protobuf parsing failed/iu);
  });
});

describe('the failure of a run of a model', () => {
  it('names a failed allocation as one, so the process that ran it ends out of memory, and passes on the others', () => {
    expect(() => rethrownNamingAllocation(new Error('Failed to allocate memory for requested buffer'))).toThrow(
      new RangeError("The model's memory allocation failed: Failed to allocate memory for requested buffer"),
    );
    expect(() => rethrownNamingAllocation('not an error')).toThrow('not an error');
  });

  it('is told by the first line of what was thrown', () => {
    expect([
      firstLineOf(new Error('  first  \nsecond')),
      firstLineOf('plain\nrest'),
      firstLineOf(new Error('')),
    ]).toEqual(['first', 'plain', '']);
  });
});

describe('the periods a model takes', () => {
  it('are none when it names no y', () => {
    expect(lengthOf([{ name: 'x', type: 'float32', shape: [1, 4, 2] }])).toBeUndefined();
  });
});
