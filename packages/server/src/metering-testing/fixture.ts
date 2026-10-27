import { ledgerLayer, sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import type { LicenseFetch } from '@on.auto/meter';
import { openedDatabase, selfHostedFixture } from '@on.auto/meter/testing';
import { Redacted } from 'effect';
import { expect, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import type { ServedParts } from '../testing/servers/served-parts.ts';

const computationSource =
  '---\nlanguage: typescript\ninput: {schema: {type: number}}\n---\nexport default function (input: any): any { return input + 1; }';
export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
export const licensePath = '/v1/runtime/license';

export async function meteredServer(
  environment: Readonly<Record<string, string>> = {},
  operatorKeyIds: readonly string[] = [],
  parts: Pick<ServedParts, 'clock' | 'programPoolOf'> = {},
  fetchOver: (fetch: LicenseFetch) => LicenseFetch = (fetch) => fetch,
) {
  const ledger = temporaryLedger();
  const fixture = await selfHostedFixture(
    () =>
      openedDatabase({
        layer: ledgerLayer({ fileName: ledger.fileName }),
        secretRows: sqliteSecretRows({ fileName: ledger.fileName }),
        key: Redacted.make(Buffer.from(secretsKey, 'base64')),
      }),
    ['computation', 'recall'],
  );
  const server = await servingReasoning([], { SECRETS_KEY: secretsKey, ...environment }, undefined, {
    ...parts,
    ledger,
    metering: { ...fixture.options, fetch: fetchOver(fixture.options.fetch), operatorKeyIds },
  });
  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= server.stop();
    return stopped;
  };
  onTestFinished(async () => {
    await stop();
    await fixture.database.close();
    ledger.remove();
  });
  return { ...fixture, ...server, stop };
}

export async function withComputation(parts: Pick<ServedParts, 'clock'> = {}) {
  const server = await meteredServer({}, [], parts);
  expect(
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } }),
  ).toMatchObject({ status: 201 });
  expect(
    await server.call('POST', `${alpha}/definitions/computation`, {
      body: { name: 'increment', source: computationSource },
    }),
  ).toMatchObject({ status: 201 });
  return {
    ...server,
    run: (id = runId) =>
      server.call('POST', `${alpha}/definitions/computation/increment/run`, { body: { input: 4, run_id: id } }),
    activate: () => server.call('POST', `${licensePath}/activate`, { body: { activationKey: 'activation-secret' } }),
  };
}
