import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainTextIn, problemIn, withMcpSession } from '@on.auto/api/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  accountsServed,
  installation,
  licensedServedBy,
  servedBy,
  standingOf,
} from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';

describe('a runtime given its license key in AUTO_RUNTIME_LICENSE_KEY', () => {
  it('activates it with the account at Auto as it starts, and admits each run itself, once per run id, asking Auto nothing', async () => {
    const accounts = await accountsServed();
    const server = await licensedServedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    const first = await tallied(server);
    const again = await tallied(server, { run_id: runIdIn(first.body) });
    const second = await tallied(server);

    expect([first.status, again.status, second.status]).toEqual([200, 200, 200]);
    expect(accounts.account.activations()).toEqual([{ installation, actions: 0, licensed: 0 }]);
    expect(accounts.reportsAsked()).toBe(0);
    expect(await standingOf(server)).toMatchObject({ state: 'licensed', licensed: 2 });
  });

  it('keeps running at the free rate once Auto says its key was rotated, never stopping', async () => {
    const accounts = await accountsServed();
    accounts.account.revoke(accounts.key, 'key_rotated');
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    await expect.poll(async () => (await standingOf(server)).state, { timeout: 60_000 }).toBe('limited');

    expect((await tallied(server)).status).toBe(200);
    expect((await server.call('GET', '/v1/orgs/acme/license')).body).toMatchObject({
      limited_because: 'key_rotated',
      free_runs: { used: 1, of: 100 },
    });
  });
});

describe('a runtime given its license key in license.key of its configuration file', () => {
  it('activates it and admits each run on its license', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const configFile = join(ledger.directory, 'auto-runtime.yaml');
    writeFileSync(configFile, 'license:\n  key: ${ACME_LICENSE_KEY}\n');
    const server = await licensedServedBy(
      accounts,
      { CONFIG_FILE: configFile, ACME_LICENSE_KEY: accounts.key },
      { ledger },
    );
    await tallied(server);

    expect(await standingOf(server)).toMatchObject({ state: 'licensed', licensed: 1 });
  });
});

describe('a key activated through the API', () => {
  it('is taken over HTTP, answering where the runtime stands, and kept, so it runs on its license after a restart too', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servedBy(accounts, {}, { ledger });
    const activated = await before.call('POST', '/v1/orgs/acme/license', { body: { key: accounts.key } });
    await tallied(before);
    await before.stop();
    const after = await servedBy(accounts, {}, { ledger });
    await tallied(after);

    expect(activated).toMatchObject({
      status: 200,
      body: { state: 'licensed', runtime_id: installation, org: 'acme', plan: 'free', runs_left: 1000 },
    });
    expect(await standingOf(after)).toMatchObject({ state: 'licensed', licensed: 2 });
  }, 60_000);
});

describe('a key activated over MCP', () => {
  it('is taken, saying where the runtime stands, or why it is not licensed', async () => {
    const accounts = await accountsServed();
    accounts.account.orgNamed('acme', 'Acme Corporation');
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
    expect(activated?.structuredContent).toMatchObject({
      state: 'licensed',
      org: 'acme',
      org_name: 'Acme Corporation',
    });
    expect(JSON.stringify(activated?.content)).toContain(
      'Licensed to Acme Corporation on the free plan, with 1000 runs left.',
    );
    expect((await tallied(server)).status).toBe(200);
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

describe('a key of an org whose account Auto says was deleted', () => {
  it('is refused as account_closed over HTTP and over MCP, in the account’s words, never to ask again shortly', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts);
    const closed = {
      because: 'org_deleted',
      detail: 'The org acme was deleted; an owner can restore it',
      resolve_at: 'https://studio.example.com/orgs/acme',
    } as const;
    accounts.account.close(closed);
    const overHttp = await server.call('POST', '/v1/orgs/acme/license', { body: { key: accounts.key } });
    const [overMcp] = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/mcp`, headers: {} },
      async (session) => [await session.callTool('activate_license', { key: accounts.key })],
    );
    const problem = { type: 'https://on.auto/problems/account_closed', status: 409, kind: 'account_closed', ...closed };

    expect(overHttp).toMatchObject({ status: 409, body: problem });
    expect({ isError: overMcp?.isError, problem: problemIn(overMcp) }).toMatchObject({ isError: true, problem });
    expect(plainTextIn(overMcp)).toContain('An owner can restore the org only for a limited time, until the date at');
    expect((await tallied(server)).status).toBe(200);
  });
});
