import { fileURLToPath } from 'node:url';

import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { saidAtStart, startedInProcess } from '../testing/processes/in-process-starts.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const { key, entry } = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

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
  credentials: readonly (string | undefined)[] = [undefined],
): Promise<{ readonly statuses: readonly number[]; readonly stderr: string }> {
  const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...env });
  const port = await child.port;
  const responses = await Promise.all(
    credentials.map((credential) =>
      fetch(`http://127.0.0.1:${port}${playbooksOfAcme}`, {
        headers: credential === undefined ? {} : { authorization: `Bearer ${credential}` },
      }),
    ),
  );
  child.signal('SIGTERM');
  await child.exited;
  return { statuses: responses.map(({ status }) => status), stderr: child.output().stderr };
}

async function statusesOn(
  env: Readonly<Record<string, string>>,
  credentials: readonly (string | undefined)[],
): Promise<readonly number[]> {
  const server = await startedInProcess({
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...noConsentThroughAuto,
    ...env,
  });
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

    expect(served.statuses).toEqual([200]);
    expect(served.stderr).toMatch(/\{"message":"Local mode is on: [^\n]*"level":"WARN"/u);
  });

  it('takes keys alone with API_KEYS and no PUBLIC_URL, and says nothing of local mode', async () => {
    const served = await servedBy({ API_KEYS: JSON.stringify([entry]) }, [undefined, key]);

    expect(served.statuses).toEqual([401, 200]);
    expect(served.stderr).not.toContain('Local mode is on');
    expect(served.stderr).not.toContain('No request can authenticate');
  });

  it('is closed when API_KEYS lists no keys, and warns that API_KEYS lists no keys', async () => {
    const served = await servedBy({ API_KEYS: '[]' });

    expect(served.statuses).toEqual([401]);
    expect(served.stderr).toMatch(/\{"message":"No request can authenticate: [^\n]*"level":"WARN"/u);
    expect(served.stderr).not.toContain('Local mode is on');
  });
});

describe('the access mode of a server with PUBLIC_URL', () => {
  it('signs people in, refuses a request without a credential, and takes the keys of API_KEYS beside them', async () => {
    const signing = await personSigningIn();

    expect(await statusesOn({ ...signing.environment, API_KEYS: JSON.stringify([entry]) }, [undefined, key])).toEqual([
      401, 200,
    ]);
  });
});

describe('a server beyond loopback with neither PUBLIC_URL nor API_KEYS', () => {
  it('stops start-up with a named error before the server listens, naming the HOST it would listen on', async () => {
    const said = await saidAtStart({ HOST: '0.0.0.0', LEDGER_FILE: ledger.fileName });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(
      /^Auto Runtime could not start: ReachableWithoutCredentialsError: [^\n]*HOST 0\.0\.0\.0/u,
    );
  });
});
