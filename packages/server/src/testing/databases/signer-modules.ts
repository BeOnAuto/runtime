import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';

import { secretsKey } from './secrets-key.ts';

const modulesLoaded = createRequire(import.meta.url).cache;

const reportingEntry = fileURLToPath(new URL('../entries/report-signer-modules.ts', import.meta.url));

export function modulesOfTheSignerLoaded(): readonly string[] {
  return Object.keys(modulesLoaded).filter((path) => path.includes('/@aws-sdk/rds-signer/'));
}

export async function modulesOfTheSignerLoadedInAProcessOfItsOwnBy(
  environment: Readonly<Record<string, string>>,
): Promise<unknown> {
  const child = spawnForTheTest(
    process.execPath,
    [reportingEntry, JSON.stringify({ SECRETS_KEY: secretsKey, ...environment })],
    {
      env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], PATH: process.env['PATH'] },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const reported: string[] = [];
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    reported.push(chunk);
  });
  await once(child, 'close');
  return JSON.parse(reported.join(''));
}
