import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiKey } from '@on.auto/identity';
import { spawnForTheTest } from '@on.auto/operations/testing';
import { afterAll, describe, expect, it } from 'vitest';

const command = fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url));

const home = mkdtempSync(join(tmpdir(), 'auto-runtime-command-'));

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

interface Started {
  readonly url: string;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly interrupt: () => void;
  readonly exited: Promise<unknown>;
}

async function started(settings: Readonly<Record<string, string>> = {}): Promise<Started> {
  const child = spawnForTheTest(process.execPath, [command], {
    cwd: home,
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      PATH: process.env['PATH'],
      HOME: home,
      PORT: '0',
      DO_NOT_TRACK: '1',
      ...settings,
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
  it('starts the server in local mode with no setting, and shows where it answers and how to sign people in', async () => {
    const runtime = await started();

    const health = await fetch(`${runtime.url}/health`);
    const playbooks = await fetch(`${runtime.url}/v1/orgs/local/playbooks`);

    expect(await health.json()).toEqual({ status: 'ok' });
    expect(await playbooks.json()).toEqual({ playbooks: [] });
    expect(runtime.output().stdout).toContain(`     MCP      ${runtime.url}/mcp\n`);
    expect(runtime.output().stdout).toContain('     Docs     https://on.auto/docs/\n');
    expect(runtime.output().stdout).toContain(
      `  Local mode: anyone on this computer acts as you, with no sign-in.\n  Set PUBLIC_URL=${runtime.url}, and no ACCESS_MODE, to sign people in.\n`,
    );
    expect(runtime.output().stderr).toBe('');
    runtime.interrupt();
    await runtime.exited;
  });

  it('trusts no request without a credential when API_KEYS is set, and says nothing of local mode', async () => {
    const runtime = await started({ API_KEYS: JSON.stringify([entry]) });

    const playbooks = await fetch(`${runtime.url}/v1/orgs/local/playbooks`);

    expect(playbooks.status).toBe(401);
    expect(runtime.output().stdout).not.toContain('Local mode');
    runtime.interrupt();
    await runtime.exited;
  });

  it('stops cleanly when Ctrl+C reaches it twice at once, as it does through npx', async () => {
    const runtime = await started();

    runtime.interrupt();
    runtime.interrupt();

    expect(await runtime.exited).toBe(0);
    expect(runtime.output().stdout).toMatch(/Stopping…\n {2}✔ Stopped\n$/u);
    expect(runtime.output().stderr).not.toContain('told to stop again');
  });
});
