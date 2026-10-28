import { once } from 'node:events';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { spawnForTheTest } from '@on.auto/operations/testing';
import type { FedShape, ModelFeeds } from '@on.auto/prediction-contract';
import { describe, expect, it } from 'vitest';

import {
  candidatePath,
  candidateSha256,
  scratchFolder,
  type CandidateName,
} from '../candidates-testing/onnx-candidates.ts';
import { lengthOf, loadModel, rethrownNamingAllocation } from './model-sessions.ts';

function loaded(name: CandidateName) {
  return loadModel(candidatePath(name), 1);
}

const twoDays: ModelFeeds = { y: { data: Float32Array.of(10, 12), dims: [1, 2] } };

const visitsFed: FedShape = { features: 0, given: 0, horizon: 2, totals: false };

interface LoadedInAProcess {
  readonly exited: readonly unknown[];
  readonly leftInItsTemporaryFolder: readonly string[];
}

async function loadedInAProcessOfItsOwn(name: CandidateName): Promise<LoadedInAProcess> {
  const temporaryFolder = scratchFolder();
  const loading = [
    `import { loadModel } from ${JSON.stringify(new URL('./model-sessions.ts', import.meta.url).href)};`,
    `await loadModel(${JSON.stringify(candidatePath(name))}, 1);`,
  ].join('\n');
  const child = spawnForTheTest(process.execPath, ['--input-type=module', '--eval', loading], {
    env: { TMPDIR: temporaryFolder },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited: readonly unknown[] = await once(child, 'exit');
  return { exited, leftInItsTemporaryFolder: readdirSync(temporaryFolder) };
}

function inTheCache(folder: string, name: CandidateName): string {
  const kept = join(folder, candidateSha256(name));
  mkdirSync(kept, { recursive: true });
  copyFileSync(candidatePath(name), join(kept, 'model.onnx'));
  return join(kept, 'model.onnx');
}

describe('a model loaded in onnxruntime', () => {
  it('signs itself with its opset, its inputs and its outputs, their types and axes, and the periods of y when it fixes them', async () => {
    const [mean, week, sequence] = await Promise.all([
      loaded('visits-mean'),
      loaded('visits-week'),
      loaded('visits-sequence'),
    ]);

    expect([mean.signature, mean.length, week.length]).toEqual([
      {
        opset: 13,
        inputs: [{ name: 'y', type: 'float32', shape: [1, 'L'] }],
        outputs: [{ name: 'q', type: 'float32', shape: [1, 2, 3] }],
      },
      undefined,
      7,
    ]);
    expect(sequence.signature['outputs']).toEqual([{ name: 'q', type: 'non-tensor', shape: [] }]);
  });

  it('turns the telemetry of onnxruntime off first, so the process it is loaded in leaves nothing in its temporary folder', async () => {
    expect(await loadedInAProcessOfItsOwn('visits-mean')).toEqual({ exited: [0, null], leftInItsTemporaryFolder: [] });
  });

  it('answers q as float32 with its dimensions', async () => {
    expect(await (await loaded('visits-mean')).run(twoDays)).toEqual({
      q: Float32Array.of(9, 11, 13, 9, 11, 13),
      dims: [1, 2, 3],
    });
  });

  it('takes h as int64 when it predicts a total', async () => {
    const answer = await (
      await loaded('totals-run-rate')
    ).run({
      y: { data: new Float32Array(14).fill(10), dims: [1, 14] },
      h: { data: BigInt64Array.of(2n), dims: [1] },
    });

    expect(answer).toEqual({ q: Float32Array.of(16, 20, 24), dims: [1, 1, 3] });
  });
});

describe('the signature a model loaded in onnxruntime has', () => {
  it('is the one the function feeds, or the issue of its tensors or of its opset', async () => {
    expect([
      (await loaded('visits-mean')).issueFor(visitsFed),
      (await loaded('orders-last')).issueFor({ features: 2, given: 1, horizon: 4, totals: false }),
      (await loaded('visits-extra-input')).issueFor(visitsFed),
      (await loaded('visits-opset-12')).issueFor(visitsFed),
    ]).toEqual([
      null,
      null,
      "The model's inputs are [y, extra] and the playbook feeds [y]; export to the published signature",
      "The model's opset is 12, and the playbook takes 13 or later",
    ]);
  });
});

describe('a model loaded in onnxruntime that does not answer', () => {
  it('answers badly when q is not float32, and passes on what the runtime refuses', async () => {
    expect(await (await loaded('visits-whole-numbers')).run(twoDays)).toEqual({
      badly: 'The model answered no q of float32',
    });
    await expect((await loaded('visits-mean')).run({})).rejects.toThrow(/input 'y' is missing/u);
  });

  it('is not loaded from a file that is not a model', async () => {
    await expect(loaded('not-a-model')).rejects.toThrow(/protobuf parsing failed/iu);
  });
});

describe('a model whose data names a file outside its own folder', () => {
  it('is not loaded, whether the file is beyond the cache, beside it by its digest, or in the folder of another model', async () => {
    const folder = scratchFolder();
    inTheCache(folder, 'visits-mean');
    const outside: readonly CandidateName[] = ['visits-hostile', 'visits-sibling', 'visits-cousin'];
    const loads = outside.map((name) =>
      loadModel(inTheCache(folder, name), 1).then(
        () => 'loaded',
        () => 'refused',
      ),
    );

    expect(await Promise.all(loads)).toEqual(['refused', 'refused', 'refused']);
  });
});

describe('the failure of a run of a model', () => {
  it('names a failed allocation as one, so the process that ran it ends out of memory, and passes on the others', () => {
    expect(() => rethrownNamingAllocation(new Error('Failed to allocate memory for requested buffer'))).toThrow(
      new RangeError("The model's memory allocation failed: Failed to allocate memory for requested buffer"),
    );
    expect(() => rethrownNamingAllocation('not an error')).toThrow('not an error');
  });
});

describe('the periods a model takes', () => {
  it('are none when it names no y', () => {
    expect(lengthOf([{ name: 'x', type: 'float32', shape: [1, 4, 2] }])).toBeUndefined();
  });
});
