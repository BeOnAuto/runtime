import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commandOf, limiterOn, memoryLimiter } from './memory-limit.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function aDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-limiter-'));
  directories.push(directory);
  return directory;
}

function holding(file: (directory: string) => void): string {
  const directory = aDirectory();
  file(join(directory, memoryLimiter));
  return directory;
}

describe('the command that bounds the memory of a process', () => {
  it('is found in the first directory of the path that holds it as an executable file', () => {
    const executable = holding((file) => {
      writeFileSync(file, '#!/bin/sh\n');
      chmodSync(file, 0o755);
    });
    const notExecutable = holding((file) => {
      writeFileSync(file, '#!/bin/sh\n');
    });
    const aFolder = holding((file) => {
      mkdirSync(file);
    });

    const path = ['', aDirectory(), notExecutable, aFolder, executable].join(delimiter);

    expect(limiterOn(path)).toBe(join(executable, memoryLimiter));
  });

  it('is looked for in the absolute directories of the path alone, and in none when there is no path', () => {
    expect(limiterOn(['relative', aDirectory()].join(delimiter))).toBeUndefined();
    expect(limiterOn()).toBeUndefined();
  });

  it('starts the process under it with a core file size of 0 and the bound of its data, or starts it plainly where there is none', () => {
    expect(commandOf('/usr/bin/prlimit', 536_870_912)).toEqual({
      command: '/usr/bin/prlimit',
      arguments: ['--core=0', '--data=536870912', process.execPath],
    });
    expect(commandOf(undefined, 536_870_912)).toEqual({ command: process.execPath, arguments: [] });
  });
});
