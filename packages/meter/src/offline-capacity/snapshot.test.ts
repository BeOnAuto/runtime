import type { ConnectionPorts } from '@on.auto/ledger';
import { allocationPayload } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineCapacity } from '../index.ts';
import { capacityFixture } from '../testing/capacity-fixture.ts';

function alteredSnapshot(connection: ConnectionPorts, pattern: string, rows: readonly unknown[]): ConnectionPorts {
  return {
    ...connection,
    readConsistently: (reads) =>
      connection.readConsistently((read) =>
        reads((sql) => (sql.strings.join('').includes(pattern) ? Promise.resolve(rows) : read(sql))),
      ),
  };
}

describe('capacity projection integrity', () => {
  it.each([
    { name: 'missing', rows: [] },
    {
      name: 'enlarged',
      rows: [
        { lot_id: 'free-1', capacity_units: 3_000_001, reserved_units: 0, committed_units: 0 },
        { lot_id: 'welcome-1', capacity_units: 2_000_000, reserved_units: 0, committed_units: 0 },
      ],
    },
    {
      name: 'foreign',
      rows: [
        { lot_id: 'unknown', capacity_units: 3_000_000, reserved_units: 0, committed_units: 0 },
        { lot_id: 'welcome-1', capacity_units: 2_000_000, reserved_units: 0, committed_units: 0 },
      ],
    },
  ])('refuses $name source projections', async ({ rows }: { readonly rows: readonly unknown[] }) => {
    const f = await capacityFixture();
    await f.capacity.install(f.token);
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: alteredSnapshot(f.options.connection, 'FROM meter_capacity_usage', rows),
    });
    await expect(capacity.snapshot()).rejects.toThrow('offline_capacity_projection_invalid');
  });
});

describe('allocation evidence consistency', () => {
  it.each(['bytes', 'id', 'epoch'])('refuses an inconsistent stored allocation %s', async (changed) => {
    const f = await capacityFixture();
    await f.capacity.install(f.token);
    const claims: Readonly<Record<string, string>> = {
      bytes: `${allocationPayload(f.allocation)} `,
      id: allocationPayload({ ...f.allocation, id: 'changed' }),
      epoch: allocationPayload({ ...f.allocation, epoch: 2 }),
    };
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: alteredSnapshot(f.options.connection, 'h.claims_json', [
        {
          revision: 0,
          state: 'open',
          checkpoint: 'checkpoint',
          claims_json: claims[changed],
        },
      ]),
    });
    await expect(capacity.snapshot()).rejects.toThrow('offline_capacity_projection_invalid');
  });

  it('refuses altered original token bytes even when a stored digest lookup matches', async () => {
    const f = await capacityFixture();
    await f.capacity.install(f.token);
    const capacity = await openOfflineCapacity({
      ...f.options,
      connection: {
        ...f.options.connection,
        read: () => Promise.resolve([{ id: f.allocation.id, epoch: 1, state: 'open', token: 'altered' }]),
      },
    });
    await expect(capacity.install(f.token)).rejects.toThrow('offline_capacity_conflict');
  });
});
