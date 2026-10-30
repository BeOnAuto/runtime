import { fileURLToPath } from 'node:url';

import { unreachableDatabase } from '@on.auto/ledger/testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { startServer } from './lifecycle.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const secret = 'a-secret-access-key';

const credentials = { AWS_ACCESS_KEY_ID: 'an-access-key', AWS_SECRET_ACCESS_KEY: secret };

async function aClosedEndpoint(): Promise<{ readonly endpoint: string; readonly host: string }> {
  const { port } = await unreachableDatabase();
  return { endpoint: `http://127.0.0.1:${String(port)}`, host: `127.0.0.1:${String(port)}` };
}

function storedIn(endpoint: string): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ':memory:',
    CONTENT_STORE_URL: 's3://playbook-content/production',
    AWS_ENDPOINT_URL: endpoint,
  };
}

function withCredentials(entries: Readonly<Record<string, string | undefined>>): void {
  Object.entries({ ...credentials, ...entries }).forEach(([name, value]: readonly [string, string | undefined]) => {
    vi.stubEnv(name, value);
  });
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

function failureToStart(environment: Readonly<Record<string, string>>): Promise<unknown> {
  return startServer(environment, compositionRoot).catch((error: unknown) => error);
}

describe('a content store whose bucket cannot be reached', () => {
  it('stops start-up with a named error that gives the setting, the bucket and the address, and no credential', async () => {
    const { endpoint, host } = await aClosedEndpoint();
    withCredentials({});

    const failure = await failureToStart({ ...storedIn(endpoint), AWS_REGION: 'us-east-1' });

    expect(failure).toMatchObject({ name: 'StartupError' });
    expect(String(failure)).toContain(`CONTENT_STORE_URL names the bucket playbook-content on ${host}`);
    expect(String(failure)).toContain(`ECONNREFUSED ${host}`);
    expect(String(failure)).not.toContain(secret);
  });

  it('stops the process with the error on one line of stderr, without a credential', async () => {
    const { endpoint, host } = await aClosedEndpoint();

    const child = spawnServer(mainModule, { ...storedIn(endpoint), AWS_REGION: 'us-east-1', ...credentials });

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Auto Runtime could not start: StartupError: The server's services could not start: .*CONTENT_STORE_URL names the bucket playbook-content on ${host.replaceAll('.', '\\.')}, which could not be reached: .*ECONNREFUSED`,
          'u',
        ),
      ),
      '',
    ]);
    expect(child.output().stderr).not.toContain(secret);
  });
});

describe('a content store without a region', () => {
  it('stops start-up, saying the region is missing, on a custom endpoint or on the endpoint of a region', async () => {
    const { endpoint, host } = await aClosedEndpoint();
    withCredentials({ AWS_REGION: undefined, AWS_PROFILE: undefined, AWS_CONFIG_FILE: '/nonexistent/aws-config' });
    const { AWS_ENDPOINT_URL: _endpoint, ...withoutEndpoint } = storedIn(endpoint);

    const failures = [await failureToStart(storedIn(endpoint)), await failureToStart(withoutEndpoint)];

    expect(failures).toMatchObject([{ name: 'StartupError' }, { name: 'StartupError' }]);
    expect(failures.map(String)).toEqual([
      expect.stringContaining(`on ${host}, which could not be reached: Error: Region is missing`),
      expect.stringContaining('on the S3 endpoint of its region, which could not be reached: Error: Region is missing'),
    ]);
  });
});
