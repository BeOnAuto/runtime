import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onTestFinished } from 'vitest';

import { temporaryLedger } from '../records/temporary-ledger.ts';
import { request, type TestResponse } from '../servers/http-client.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { spawnServer, type SpawnedServer } from './spawned-server.ts';

const mainModule = fileURLToPath(new URL('../../main.ts', import.meta.url));

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

export interface ConfiguredServer {
  readonly child: SpawnedServer;
  readonly configFile: string;
}

export function configuredServer(
  configText: string | undefined,
  environment: Readonly<Record<string, string>>,
): ConfiguredServer {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  const configFile = join(ledger.directory, 'auto-runtime.yaml');
  if (configText !== undefined) {
    writeFileSync(configFile, configText);
  }
  const child = spawnServer(mainModule, {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...(configText === undefined ? {} : { CONFIG_FILE: configFile }),
    ...environment,
  });
  return { child, configFile };
}

export async function rejectedRun(port: number, key?: string): Promise<TestResponse> {
  const caller = key === undefined ? {} : { key };
  await request(port, 'POST', '/v1/orgs/acme/playbooks', { ...caller, body: { playbook: 'alpha', name: 'Alpha' } });
  await request(port, 'POST', `${alpha}/definitions/reasoning`, {
    ...caller,
    body: { name: 'verdict', source: verdict },
  });
  return request(port, 'POST', `${alpha}/definitions/reasoning/verdict/run`, {
    ...caller,
    body: { input: { expense: 'a dinner' } },
  });
}

export async function stoppedOutput(child: SpawnedServer): Promise<string> {
  child.signal('SIGTERM');
  await child.exited;
  return child.output().stderr;
}

export function settingLines(stderr: string): readonly string[] {
  return stderr
    .split('\n')
    .filter((line) => line.includes('"config_file"'))
    .map((line) => String(/"message":"((?:[^"\\]|\\.)*)"/u.exec(line)?.[1]));
}
