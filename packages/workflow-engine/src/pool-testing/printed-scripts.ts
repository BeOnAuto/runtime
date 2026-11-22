import { once } from 'node:events';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { expect } from 'vitest';

/** Runs the script in a Node process of its own, as a server would, and answers what it printed once it ended well. */
export async function printedByTheScript(script: string): Promise<string> {
  const child = spawnForTheTest(process.execPath, ['--eval', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const printed = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
  });
  const ended: readonly unknown[] = await once(child, 'close');
  expect(ended).toEqual([0, null]);
  return printed.text;
}
