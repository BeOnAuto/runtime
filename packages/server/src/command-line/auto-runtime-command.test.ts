import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { admittedByTheMeterIn, aRunOfTallyAt } from '../testing/records/metered-runs.ts';
import { servedStudioHomeOf, welcomeLinking } from '../testing/studios/welcome.ts';

const command = fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url));

const home = mkdtempSync(join(tmpdir(), 'auto-runtime-command-'));

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

interface Started {
  readonly url: string;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly interrupt: () => void;
  readonly exited: Promise<unknown>;
}

async function started(): Promise<Started> {
  const child = spawnForTheTest(process.execPath, [command], {
    cwd: home,
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      PATH: process.env['PATH'],
      HOME: home,
      PORT: '0',
      DO_NOT_TRACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  const { promise: ready, resolve } = Promise.withResolvers<string>();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    if (output.stdout.includes('Press Ctrl+C')) {
      resolve(output.stdout);
    }
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  const shown = await ready;
  return {
    url: /Server {3}(http:\/\/localhost:\d+)/u.exec(shown)?.[1] ?? '',
    output: () => ({ ...output }),
    interrupt: () => {
      child.kill('SIGINT');
    },
    exited,
  };
}

describe('the auto-runtime command', () => {
  it('starts the server in local mode with no setting, shows where it answers, its free runs and how to require sign-in, admits each run by its meter, and stops cleanly when Ctrl+C reaches it twice at once, as it does through npx', async () => {
    const runtime = await started();

    const health = await fetch(`${runtime.url}/health`);
    const playbooks = await fetch(`${runtime.url}/v1/orgs/local/playbooks`);
    const playbooksBefore: unknown = await playbooks.json();
    const run = await aRunOfTallyAt(runtime.url);
    runtime.interrupt();
    runtime.interrupt();

    expect(await runtime.exited).toBe(0);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(playbooksBefore).toEqual({ playbooks: [], welcome: welcomeLinking(servedStudioHomeOf(runtime.url)) });
    expect(runtime.output().stdout).toContain(`     MCP      ${runtime.url}/mcp\n`);
    expect(runtime.output().stdout).toContain('     Docs     https://on.auto/docs/\n');
    expect(runtime.output().stdout).toMatch(
      /\n {2}This runtime has used 0 of its 100 free runs\. After that, without a license key, it's limited to the free rate of 15 runs a UTC day and 75 a UTC month\. Get a free license key at https:\/\/\S+\/licenses\?installation=[\da-f-]+\.\n {2}Local mode: no sign-in, so anyone using this computer can act as you\. To require sign-in, set PUBLIC_URL\.\n/u,
    );
    expect(runtime.output().stdout).toMatch(/Stopping…\n {2}✔ Stopped\n$/u);
    expect(runtime.output().stderr).toBe('');
    expect(await admittedByTheMeterIn(join(home, '.auto-runtime', 'ledger.db'))).toEqual([`org/local/runs/${run}`]);
  });
});
