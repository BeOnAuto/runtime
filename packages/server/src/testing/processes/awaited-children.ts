import { spawn } from 'node:child_process';
import { once } from 'node:events';

/*
 * Children a test runs to their end, awaited rather than run synchronously: the test files share a process, and a
 * synchronous child would hold it, and every test and timer in it, until the child ended.
 */

export interface EndedChild {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the program to its end and gives its exit code and what it wrote. */
export async function ranToItsEnd(
  program: string,
  args: readonly string[],
  { cwd, env }: { readonly cwd?: string; readonly env?: Readonly<Record<string, string | undefined>> } = {},
): Promise<EndedChild> {
  const child = spawn(program, [...args], {
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env: { ...env } }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const written = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    written.stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    written.stderr += chunk;
  });
  await once(child, 'close');
  return { code: child.exitCode, ...written };
}

/**
 * The pid of a process that is gone, with no process started to find one: one above the most a pid can be, 2^22 on
 * Linux and less on macOS, so no process has it.
 */
export function aGoneProcess(): number {
  return 2 ** 22 + 1;
}
