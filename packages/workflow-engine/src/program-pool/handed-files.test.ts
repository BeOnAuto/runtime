import { shippedFilesInMemory } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { sandboxModuleFile } from '../instances/fresh-instances.ts';
import { handedFile, handedFileIn, handedFilesOf, handedTo, handedWorkersOf } from './handed-files.ts';

const shipped = new URL('file:///shipped/');

const lib = new URL('lib.txt', shipped);

const checker = new URL('file:///workers/checker.ts');

const runner = new URL('file:///workers/runner.ts');

const memory = shippedFilesInMemory({
  [sandboxModuleFile.href]: Uint8Array.of(1, 2),
  [lib.href]: Uint8Array.of(3),
});

function bytesOf(handed: Readonly<Record<string, Readonly<Uint8Array>>>): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(handed).map(([href, bytes]: readonly [string, Readonly<Uint8Array>]) => [href, [...bytes]]),
  );
}

describe('the files a composition hands the workers of a pool', () => {
  it('are the bytes of the files it names, read through the reader, by the address of each', async () => {
    expect(bytesOf(await handedFilesOf(memory, [lib, sandboxModuleFile]))).toEqual({
      [lib.href]: [3],
      [sandboxModuleFile.href]: [1, 2],
    });
  });

  it('are, for every worker, the module of the sandbox, and for the workers of a module named, its own files instead', async () => {
    const handed = await handedWorkersOf(memory, { [checker.href]: await handedFilesOf(memory, [lib]) });

    expect(bytesOf(handedTo(handed, runner))).toEqual({ [sandboxModuleFile.href]: [1, 2] });
    expect(bytesOf(handedTo(handed, checker))).toEqual({ [lib.href]: [3] });
    expect(bytesOf(handedTo({ sandbox: handed.sandbox }, checker))).toEqual({ [sandboxModuleFile.href]: [1, 2] });
  });

  it('fail to be read when the reader cannot read one of them', async () => {
    await expect(handedFilesOf(memory, [new URL('missing.bin', shipped)])).rejects.toThrow('missing.bin');
  });
});

describe('a file a worker reads of those it was handed', () => {
  it('is the bytes the pool handed it', () => {
    expect([...handedFile(lib, { handed: { [lib.href]: Uint8Array.of(7) } })]).toEqual([7]);
    expect([...handedFileIn({ [lib.href]: Uint8Array.of(8) })(lib)]).toEqual([8]);
  });

  it('is refused when the pool handed the worker no such file, or nothing it can read', () => {
    const refused = `The pool handed this worker no file at ${lib.href}`;

    expect(() => handedFile(lib, { handed: {} })).toThrow(refused);
    expect(() => handedFile(lib, { handed: { [lib.href]: 'not bytes' } })).toThrow(refused);
    expect(() => handedFile(lib)).toThrow(refused);
    expect(() => handedFileIn({})(lib)).toThrow(refused);
  });
});
