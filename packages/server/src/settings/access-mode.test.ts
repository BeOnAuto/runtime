import { fileURLToPath } from 'node:url';

import { createApiKey, signInScopes } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const { key, entry } = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const publicUrl = 'http://localhost:5555';

const playbooksOfAcme = '/v1/orgs/acme/playbooks';

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

async function servedBy(
  env: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ readonly status: number; readonly stderr: string }> {
  const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...env });
  const response = await fetch(`http://127.0.0.1:${await child.port}${playbooksOfAcme}`, { headers });
  child.signal('SIGTERM');
  await child.exited;
  return { status: response.status, stderr: child.output().stderr };
}

async function statusesOn(
  env: Readonly<Record<string, string>>,
  credentials: readonly (string | undefined)[],
): Promise<readonly number[]> {
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, PREDICTION_CACHE_DIR: ledger.cacheDirectory, ...env },
    compositionRoot,
  );
  const responses = await Promise.all(
    credentials.map((credential) =>
      fetch(`http://127.0.0.1:${server.port}${playbooksOfAcme}`, {
        headers: credential === undefined ? {} : { authorization: `Bearer ${credential}` },
      }),
    ),
  );
  await server.stop();
  return responses.map(({ status }) => status);
}

describe('the access mode of a server on loopback', () => {
  it('is local with neither PUBLIC_URL nor API_KEYS, trusts a request without a credential and warns that it does', async () => {
    const served = await servedBy({});

    expect(served.status).toBe(200);
    expect(served.stderr).toContain(
      '"message":"Local mode is on: every request is trusted as the local developer, with every permission in every org. On a machine reachable through a proxy, set PUBLIC_URL or API_KEYS instead, and no ACCESS_MODE"',
    );
    expect(served.stderr).toContain('"level":"WARN"');
  });

  it('takes keys alone with API_KEYS and no PUBLIC_URL, and says nothing of local mode', async () => {
    const withoutKey = await servedBy({ API_KEYS: JSON.stringify([entry]) });
    const withKey = await servedBy({ API_KEYS: JSON.stringify([entry]) }, { authorization: `Bearer ${key}` });

    expect([withoutKey.status, withKey.status]).toEqual([401, 200]);
    expect(withoutKey.stderr).not.toContain('Local mode is on');
    expect(withoutKey.stderr).not.toContain('No request can authenticate');
  });

  it('is closed when API_KEYS lists no keys, and warns that API_KEYS lists no keys', async () => {
    const served = await servedBy({ API_KEYS: '[]' });

    expect(served.status).toBe(401);
    expect(served.stderr).toContain(
      '"message":"No request can authenticate: API_KEYS lists no keys, so every path answers 401 except /health, the OpenAPI document at /v1/openapi.json, the guides under /v1/guides and the API catalog at /.well-known/api-catalog"',
    );
    expect(served.stderr).not.toContain('Local mode is on');
  });
});

describe('the access mode of a server with PUBLIC_URL', () => {
  it('signs people in, and refuses a request without a credential', async () => {
    const issuer = await issuerOverHttps();
    const token = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));

    expect(await statusesOn({ IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl }, [undefined, token])).toEqual([
      401, 200,
    ]);
  });

  it('takes the keys of API_KEYS beside the people it signs in', async () => {
    const issuer = await issuerOverHttps();
    const token = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));

    expect(
      await statusesOn({ IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl, API_KEYS: JSON.stringify([entry]) }, [
        undefined,
        key,
        token,
      ]),
    ).toEqual([401, 200, 200]);
  });
});

describe('a server beyond loopback with neither PUBLIC_URL nor API_KEYS', () => {
  it('stops start-up with a named error before the server listens, naming the HOST it would listen on', async () => {
    const child = spawnServer(mainModule, { HOST: '0.0.0.0', PORT: '0', LEDGER_FILE: ledger.fileName });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'Auto Runtime could not start: ReachableWithoutCredentialsError: A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST 0.0.0.0; where only this computer reaches its port, ACCESS_MODE=local with a PUBLIC_URL on the loopback declares local mode instead\n',
    });
  });
});
