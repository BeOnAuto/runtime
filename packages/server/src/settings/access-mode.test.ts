import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { startedInProcess } from '../testing/processes/in-process-starts.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';

const { key, entry } = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const playbooksOfAcme = '/v1/orgs/acme/playbooks';

const localMode = 'Local mode is on';

const noRequestCanAuthenticate = 'No request can authenticate';

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

interface Served {
  readonly answers: readonly (readonly [number, string | null])[];
  readonly logged: string;
}

async function servedBy(
  env: Readonly<Record<string, string>>,
  credentials: readonly (string | undefined)[],
): Promise<Served> {
  const logged = vi.spyOn(console, 'error');
  onTestFinished(() => {
    logged.mockRestore();
  });
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
  return {
    answers: responses.map(({ status, headers }) => [status, headers.get('www-authenticate')] as const),
    logged: logged.mock.calls.flat().map(String).join('\n'),
  };
}

type Asked = readonly [credential: string | undefined, status: number, challenge: string | null];

const onLoopback: ReadonlyArray<
  readonly [string, Readonly<Record<string, string>>, readonly Asked[], readonly string[]]
> = [
  [
    'local with neither PUBLIC_URL nor API_KEYS, trusting a request without a credential',
    {},
    [[undefined, 200, null]],
    [localMode],
  ],
  [
    'taking keys alone with API_KEYS and no PUBLIC_URL',
    { API_KEYS: JSON.stringify([entry]) },
    [
      [undefined, 401, 'Bearer'],
      [key, 200, null],
    ],
    [],
  ],
  ['closed when API_KEYS lists no keys', { API_KEYS: '[]' }, [[undefined, 401, 'Bearer']], [noRequestCanAuthenticate]],
];

describe('the access mode of a server on loopback', () => {
  it.each(onLoopback)('is %s, and logs the warning of that mode alone', async (_mode, env, asked, warnings) => {
    const served = await servedBy(
      env,
      asked.map(([credential]) => credential),
    );

    expect(served.answers).toEqual(asked.map(([, status, challenge]) => [status, challenge]));
    expect([localMode, noRequestCanAuthenticate].filter((warning) => served.logged.includes(warning))).toEqual(
      warnings,
    );
  });
});

describe('the access mode of a server with PUBLIC_URL', () => {
  it('signs people in, refuses a request without a credential, and takes the keys of API_KEYS beside them', async () => {
    const signing = await personSigningIn();

    const served = await servedBy({ ...signing.environment, API_KEYS: JSON.stringify([entry]) }, [undefined, key]);

    expect(served.answers.map(([status]) => status)).toEqual([401, 200]);
  });
});
