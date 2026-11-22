import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';

import { secretsKey } from './secrets-key.ts';

const modulesLoaded = createRequire(import.meta.url).cache;

export function modulesOfTheSignerLoaded(): readonly string[] {
  return Object.keys(modulesLoaded).filter((path) => path.includes('/@aws-sdk/rds-signer/'));
}

/**
 * What an entry under testing/entries writes to its output, run in a process of its own: the modules a process loads
 * are the process's, so a test that says a module is not loaded asks a process no other test file has run in. The
 * entry is named by a `new URL` of its file beside the call, the form knip follows to the entry.
 */
export async function reportedByAProcessOfItsOwn(entry: Readonly<URL>, argument: unknown): Promise<unknown> {
  const child = spawnForTheTest(process.execPath, [fileURLToPath(entry.href), JSON.stringify(argument)], {
    env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], PATH: process.env['PATH'] },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const reported: string[] = [];
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    reported.push(chunk);
  });
  await once(child, 'close');
  return JSON.parse(reported.join(''));
}

export function modulesOfTheSignerLoadedInAProcessOfItsOwnBy(
  environment: Readonly<Record<string, string>>,
): Promise<unknown> {
  return reportedByAProcessOfItsOwn(new URL('../entries/report-signer-modules.ts', import.meta.url), {
    SECRETS_KEY: secretsKey,
    ...environment,
  });
}
