import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import type { ProcessCommand } from './process-thread.ts';

export const memoryLimiter = 'prlimit';

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function limiterOn(path?: string): string | undefined {
  return (path ?? '')
    .split(delimiter)
    .filter((directory) => isAbsolute(directory))
    .map((directory) => join(directory, memoryLimiter))
    .find((file) => isExecutable(file));
}

export function commandOf(limiter: string | undefined, memoryBytes: number): ProcessCommand {
  return limiter === undefined
    ? { command: process.execPath, arguments: [] }
    : { command: limiter, arguments: ['--core=0', `--data=${memoryBytes}`, process.execPath] };
}
