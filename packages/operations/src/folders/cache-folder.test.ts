import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { cacheFolderProblem } from '../index.ts';

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-cache-folder-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function folderWithMode(mode: number): string {
  const folder = join(scratchDirectory(), 'cache');
  mkdirSync(folder);
  chmodSync(folder, mode);
  return folder;
}

describe('the folder a cache of the server keeps its files in', () => {
  it('is made readable by its owner alone when it is not there yet, and taken when its owner alone may write to it', async () => {
    const notYet = join(scratchDirectory(), 'not-yet', 'cache');

    expect([
      await cacheFolderProblem(notYet),
      await cacheFolderProblem(folderWithMode(0o700)),
      await cacheFolderProblem(folderWithMode(0o755)),
    ]).toEqual([undefined, undefined, undefined]);
    expect(statSync(notYet).mode & 0o777).toBe(0o700);
  });

  it('is refused when it is a file, cannot be made, belongs to another user, or others may write to it', async () => {
    const file = join(scratchDirectory(), 'a-file');
    writeFileSync(file, '');
    const owned = folderWithMode(0o700);

    expect([
      await cacheFolderProblem(file),
      await cacheFolderProblem(join(file, 'cache')),
      await cacheFolderProblem(owned, statSync(owned).uid + 1),
      await cacheFolderProblem(folderWithMode(0o770)),
      await cacheFolderProblem(folderWithMode(0o707)),
    ]).toEqual([
      'is not a folder',
      'could not be made',
      'belongs to another user',
      'may be written by users other than its owner',
      'may be written by users other than its owner',
    ]);
  });
});
