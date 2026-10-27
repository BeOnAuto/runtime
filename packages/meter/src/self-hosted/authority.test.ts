import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openSelfHostedMeter } from '../index.ts';
import { reserveRequest } from '../offline-testing/fixture.ts';
import { selfHostedFixture } from '../self-hosted-testing/fixture.ts';

function alteredHistory(
  connection: ConnectionPorts,
  change: (rows: readonly unknown[]) => readonly unknown[],
): ConnectionPorts {
  return {
    ...connection,
    read: async (sql) => {
      const rows = await connection.read(sql);
      return sql.strings.join('').includes('FROM meter_license_history') ? change(rows) : rows;
    },
  };
}

const row = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

describe('persisted capacity delivery evidence', () => {
  it('refuses missing capacity history after accepting an entitlement', async () => {
    const f = await selfHostedFixture();
    const meter = await openSelfHostedMeter({
      ...f.options,
      connection: alteredHistory(f.options.connection, () => []),
    });
    await expect(meter.license.activate('activation-secret')).rejects.toThrow('license_history_unavailable');
    expect((await meter.license.head()).state).toBe('active');
    expect(await meter.capacity()).toBeUndefined();
  });

  it.each(['[]', '[] '])('refuses a mismatched or noncanonical allocation history %s', async (allocationJson) => {
    const f = await selfHostedFixture();
    const meter = await openSelfHostedMeter({
      ...f.options,
      connection: alteredHistory(f.options.connection, (rows) =>
        rows.map((value) => ({ ...row(value), allocation_json: allocationJson })),
      ),
    });
    await expect(meter.license.activate('activation-secret')).rejects.toThrow('license_allocation_history_invalid');
    expect(await meter.capacity()).toBeUndefined();
  });
});

describe('capacity needs its own authority', () => {
  it('never installs a signed capacity belonging to another installation', async () => {
    const f = await selfHostedFixture();
    f.state.allocations = [{ ...f.allocation, installationId: 'another-installation' }];
    await expect(f.meter.license.activate('activation-secret')).rejects.toThrow('another authority or installation');
    expect((await f.meter.license.head()).state).toBe('active');
    expect(await f.meter.capacity()).toBeUndefined();
    f.state.allocations = [f.allocation];
    await f.meter.license.refresh();
    expect((await f.meter.capacity())?.allocation).toEqual(f.allocation);
  });

  it('does not reuse an earlier epoch while its usage remains unresolved', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    f.state.allocations = [{ ...f.allocation, id: 'replacement', epoch: 2 }];
    await expect(f.meter.license.refresh()).rejects.toThrow('offline_allocation_unresolved');
    expect((await f.meter.capacity())?.allocation.id).toBe(f.allocation.id);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_capacity_history`)).toHaveLength(1);
  });

  it('retains expired capacity evidence without making its source funds available again', async () => {
    const f = await selfHostedFixture();
    f.state.allocations = [{ ...f.allocation, expiresAt: 6000 }];
    f.pass(2000);
    await expect(f.meter.license.activate('activation-secret')).rejects.toThrow('stale or outside its trusted time');
    expect((await f.meter.license.head()).state).toBe('active');
    expect(await f.meter.capacity()).toBeUndefined();
  });
});

describe('maintenance authorization', () => {
  it('preserves the installed capacity and original deadline after transient refresh failure', async () => {
    const f = await selfHostedFixture();
    const original = await f.meter.license.activate('activation-secret');
    f.pass(86_400_000);
    f.authority.state.completeStatus = 503;
    expect(await f.meter.license.poll()).toEqual({ status: 'failed', retryInMilliseconds: 30_000 });
    expect((await f.meter.license.current()).license.offlineDeadline).toBe(original.license.offlineDeadline);
    expect((await f.meter.capacity())?.allocation).toEqual(f.allocation);
    f.authority.state.completeStatus = 0;
    f.pass(30_000);
    expect((await f.meter.license.poll()).status).toBe('refreshed');
  });

  it('does not restore a confirmed refusal during the maintenance backoff', async () => {
    const f = await selfHostedFixture();
    await f.meter.license.activate('activation-secret');
    f.pass(86_400_000);
    f.authority.state.completeStatus = 403;
    expect((await f.meter.license.poll()).status).toBe('failed');
    expect((await f.meter.license.poll()).status).toBe('idle');
    expect((await f.meter.license.head()).state).toBe('refused');
    await expect(f.meter.accounting.reserve(await reserveRequest())).rejects.toThrow('license_not_active');
    expect((await f.meter.capacity())?.allocation).toEqual(f.allocation);
  });
});
