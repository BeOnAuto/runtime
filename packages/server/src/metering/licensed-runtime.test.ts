import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { problemIn, withMcpSession } from '@on.auto/api/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountsServed, installation, servedBy, studio } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

function actionOf(response: { readonly body: unknown }): string {
  return `installation:${installation}/acme/alpha/${runIdIn(response.body).toLowerCase()}`;
}

describe('a runtime given its license key in AUTO_RUNTIME_LICENSE_KEY', () => {
  it('activates it with the account at Auto, and admits each run by the account, once per run id', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    const first = await tallied(server);
    const again = await tallied(server, { run_id: runIdIn(first.body) });
    const second = await tallied(server);

    expect([first.status, again.status, second.status]).toEqual([200, 200, 200]);
    expect(accounts.account.charged()).toEqual([actionOf(first), actionOf(second)]);
    expect(accounts.account.activations()[0]).toMatchObject({ installation });
  });

  it('refuses new runs as license_invalid once the key is revoked, and as credits_exhausted when the org has none', async () => {
    const revoked = await accountsServed();
    const revokedServer = await servedBy(revoked, { AUTO_RUNTIME_LICENSE_KEY: revoked.key });
    await tallied(revokedServer);
    revoked.account.revoke(revoked.key);
    const exhausted = await accountsServed();
    exhausted.account.exhaust();
    const exhaustedServer = await servedBy(exhausted, { AUTO_RUNTIME_LICENSE_KEY: exhausted.key });

    const refused = await tallied(revokedServer);
    expect(refused).toMatchObject({ status: 409, body: { kind: 'license_invalid' } });
    expect(JSON.stringify(refused.body)).toContain(`${studio}/licenses?installation=${installation}`);
    expect(await tallied(exhaustedServer)).toMatchObject({
      status: 409,
      body: { kind: 'credits_exhausted', detail: 'The org acme has no credits left' },
    });
  });
});

describe('a runtime given its license key in license.key of its configuration file', () => {
  it('activates it and admits each run by the account', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const configFile = join(ledger.directory, 'auto-runtime.yaml');
    writeFileSync(configFile, 'license:\n  key: ${ACME_LICENSE_KEY}\n');
    const server = await servedBy(accounts, { CONFIG_FILE: configFile, ACME_LICENSE_KEY: accounts.key }, { ledger });
    const ran = await tallied(server);

    expect(accounts.account.charged()).toEqual([actionOf(ran)]);
  });
});

describe('a key activated through the API', () => {
  it('is taken over HTTP and kept, so the runtime admits by the account after a restart too', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servedBy(accounts, {}, { ledger });
    const activated = await before.call('POST', '/v1/orgs/acme/license', { body: { key: accounts.key } });
    const first = await tallied(before);
    await before.stop();
    const after = await servedBy(accounts, {}, { ledger });
    const second = await tallied(after);

    expect(activated).toMatchObject({ status: 200, body: { installation, org: 'acme', plan: 'free' } });
    expect(accounts.account.charged()).toEqual([actionOf(first), actionOf(second)]);
  }, 60_000);

  it('is taken over MCP, answering what the runtime is licensed to, or why it is not', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts);
    const [refused, activated] = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/mcp`, headers: {} },
      async (session) => [
        await session.callTool('activate_license', { key: `alk.acme.${installation}.unknown` }),
        await session.callTool('activate_license', { key: accounts.key }),
      ],
    );

    expect(problemIn(refused)).toMatchObject({ status: 409, kind: 'license_invalid' });
    expect(activated.structuredContent).toMatchObject({ installation, org: 'acme', plan: 'free' });
    expect((await tallied(server)).status).toBe(200);
    await until(() => accounts.account.charged().length === 1);
  });

  it('refuses what is not a key of Studio, a key Auto does not know, and answers unavailable while Auto cannot be reached', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts);
    const malformed = await server.call('POST', '/v1/orgs/acme/license', { body: { key: 'ak_one_two' } });
    const unknown = await server.call('POST', '/v1/orgs/acme/license', {
      body: { key: `alk.acme.${installation}.unknown` },
    });
    accounts.account.goDown();
    const unreached = await server.call('POST', '/v1/orgs/acme/license', { body: { key: accounts.key } });

    expect([malformed.status, unknown.status, unreached.status]).toEqual([422, 409, 503]);
    expect(unknown.body).toMatchObject({ kind: 'license_invalid' });
    expect(unreached.body).toMatchObject({ kind: 'meter_unavailable' });
  });
});
