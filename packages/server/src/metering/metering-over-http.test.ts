import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { licensePath, runId, withComputation } from '../metering-testing/fixture.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

describe('a licensed Runtime over HTTP', () => {
  it('activates, runs a real computation once, settles its journal and reports its signed charge', async () => {
    const server = await withComputation();
    expect(await server.call('GET', licensePath)).toMatchObject({
      status: 200,
      body: { head: { state: 'unlicensed' }, usable: false, capacity: null },
    });
    expect(await server.activate()).toMatchObject({
      status: 200,
      body: { license: { accountId: 'account-1', plan: 'free' } },
    });
    expect(await server.run()).toMatchObject({ status: 200, body: { status: 'succeeded', output: 5 } });
    expect(await server.run()).toMatchObject({ status: 200, body: { status: 'succeeded', output: 5 } });
    expect(await server.call('GET', licensePath)).toMatchObject({
      status: 200,
      body: { usable: true, capacity: { counters: [{ committedUnits: '1000000' }] } },
    });
    expect(await server.call('POST', `${licensePath}/report`)).toMatchObject({
      status: 200,
      body: { delivery: { state: 'open' } },
    });
    expect(await server.database.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
    expect(server.received.at(-1)).toMatchObject({
      charges: [{ runId, parts: [{ units: 1_000_000n }] }],
      counters: [{ reservedUnits: 0n, committedUnits: 1_000_000n }],
    });
  });
});

describe('license refusal and repair over HTTP', () => {
  it('records a refusal before activation while retaining definition inspection and a fresh licensed attempt', async () => {
    const server = await withComputation();
    expect(await server.run()).toMatchObject({
      status: 409,
      body: { detail: 'Activate this Runtime installation with its license key before running a function.' },
    });
    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      status: 200,
      body: { status: 'rejected' },
    });
    expect(await server.call('GET', `${alpha}/definitions/computation/increment`)).toMatchObject({ status: 200 });
    expect(await server.activate()).toMatchObject({ status: 200 });
    expect(await server.run('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b')).toMatchObject({
      status: 200,
      body: { output: 5 },
    });
    expect(await server.call('POST', `${licensePath}/refresh`)).toMatchObject({ status: 200 });
    expect(await server.call('POST', `${licensePath}/close`, { body: { allocationId: 'allocation-1' } })).toMatchObject(
      { status: 200, body: { state: 'closing' } },
    );
    expect(await server.call('POST', `${licensePath}/report`)).toMatchObject({
      status: 200,
      body: { delivery: { state: 'closed' } },
    });
  });
});
