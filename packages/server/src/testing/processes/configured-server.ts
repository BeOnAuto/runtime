import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { onTestFinished, vi } from 'vitest';

import { temporaryLedger } from '../records/temporary-ledger.ts';
import { request, type TestResponse } from '../servers/http-client.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { givenGoals } from '../settings/goals-kept.ts';
import { startedInProcess } from './in-process-starts.ts';

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
  /** The port of the server main starts, in this process, with the configuration file and the environment given. */
  readonly port: Promise<number>;
  readonly configFile: string;
  /** Stops the server and answers the lines it logged from its start, one to a line. */
  readonly stopped: () => Promise<string>;
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
  const logged = vi.spyOn(console, 'error');
  onTestFinished(() => {
    logged.mockRestore();
  });
  const starting = startedInProcess({
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...(configText === undefined ? {} : { CONFIG_FILE: configFile }),
    ...environment,
  });
  return {
    port: starting.then(({ port }) => port),
    configFile,
    stopped: async () => {
      await (await starting).stop();
      return logged.mock.calls
        .flat()
        .map((line) => `${String(line)}\n`)
        .join('');
    },
  };
}

export async function rejectedRun(port: number, key?: string): Promise<TestResponse> {
  const caller = key === undefined ? {} : { key };
  await request(port, 'POST', '/v1/orgs/acme/playbooks', {
    ...caller,
    body: { playbook: 'alpha', name: 'Alpha', goals: givenGoals },
  });
  await request(port, 'POST', `${alpha}/definitions/reasoning`, {
    ...caller,
    body: { name: 'verdict', source: verdict, diagram: 'none' },
  });
  return request(port, 'POST', `${alpha}/definitions/reasoning/verdict/run`, {
    ...caller,
    body: { input: { expense: 'a dinner' } },
  });
}

export function settingLines(stderr: string): readonly string[] {
  return stderr
    .split('\n')
    .filter((line) => line.includes('"config_file"'))
    .map((line) => String(/"message":"((?:[^"\\]|\\.)*)"/u.exec(line)?.[1]));
}
