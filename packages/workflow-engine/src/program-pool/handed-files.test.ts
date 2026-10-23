import { shippedFileName, type ShippedFile } from '@on.auto/operations';
import { shippedFilesInMemory } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { sandboxModuleFile } from '../instances/compiled-module.ts';
import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import {
  handedData,
  handedFile,
  handedFileIn,
  handedFilesOf,
  handedSandboxOf,
  handedTo,
  handedWorkersOf,
} from './handed-files.ts';

const checking = '@acme/checking';

const lib: ShippedFile = { package: checking, path: 'lib/lib.txt' };

const checker = new URL('file:///workers/checker.ts');

const runner = new URL('file:///workers/runner.ts');

const memory = shippedFilesInMemory({
  [sandboxModuleFile.package]: { [sandboxModuleFile.path]: Uint8Array.of(1, 2) },
  [checking]: { [lib.path]: Uint8Array.of(3) },
});

const libName = shippedFileName(lib);

const sandboxName = shippedFileName(sandboxModuleFile);

function bytesOf(handed: Readonly<Record<string, Readonly<Uint8Array>>>): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(handed).map(([href, bytes]: readonly [string, Readonly<Uint8Array>]) => [href, [...bytes]]),
  );
}

describe('the files a composition hands the workers of a pool', () => {
  it('are the bytes of the files it names, read through the reader, by the address of each', async () => {
    expect(bytesOf(await handedFilesOf(memory, [lib, sandboxModuleFile]))).toEqual({
      [libName]: [3],
      [sandboxName]: [1, 2],
    });
  });

  it('are, for every worker, the module of the sandbox, and for the workers of a module named, its own files instead', async () => {
    const handed = await handedWorkersOf(memory, { [checker.href]: await handedFilesOf(memory, [lib]) });

    expect(bytesOf(handedTo(handed, runner))).toEqual({ [sandboxName]: [1, 2] });
    expect(bytesOf(handedTo(handed, checker))).toEqual({ [libName]: [3] });
    expect(bytesOf(handedTo({ sandbox: handed.sandbox }, checker))).toEqual({ [sandboxName]: [1, 2] });
  });

  it('cross to a worker with the source of instances the pool names', async () => {
    const handed = await handedWorkersOf(memory, { [checker.href]: await handedFilesOf(memory, [lib]) });

    expect(handedData({ handed, instances: 'kept' }, checker)).toEqual({
      handed: { [libName]: Uint8Array.of(3) },
      instances: 'kept',
    });
  });

  it('fail to be read when the reader cannot read one of them', async () => {
    await expect(handedFilesOf(memory, [{ package: checking, path: 'missing.bin' }])).rejects.toThrow('missing.bin');
  });
});

describe('a file a worker reads of those it was handed', () => {
  it('is the bytes the pool handed it', () => {
    expect([...handedFile(lib, { handed: { [libName]: Uint8Array.of(7) } })]).toEqual([7]);
    expect([...handedFileIn({ [libName]: Uint8Array.of(8) })(lib)]).toEqual([8]);
  });

  it('is refused when the pool handed the worker no such file, or nothing it can read', () => {
    const refused = `The pool handed this worker no file at ${libName}`;

    expect(() => handedFile(lib, { handed: {} })).toThrow(refused);
    expect(() => handedFile(lib, { handed: { [libName]: 'not bytes' } })).toThrow(refused);
    expect(() => handedFile(lib)).toThrow(refused);
    expect(() => handedFileIn({})(lib)).toThrow(refused);
  });
});

describe('the instances of the sandbox a worker takes', () => {
  it('are refused when the pool named the worker no source of them', async () => {
    await expect(handedSandboxOf({ handed: {} })(unitMemoryBytes)).rejects.toThrow('no source of instances');
  });

  it('come of the module of the sandbox read when a unit first asks for one, so a worker handed none is refused only then', async () => {
    const source = handedSandboxOf({ handed: {}, instances: 'kept' });

    await expect(source(unitMemoryBytes)).rejects.toThrow(`The pool handed this worker no file at ${sandboxName}`);
  });
});
