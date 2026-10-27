import { describe, expect, it } from 'vitest';

import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { runtimeFixture } from '../runtime-testing/fixture.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('licensed Runtime computations on PostgreSQL', () => {
  it('runs, records and settles against the same durable database used by the shared meter', async () => {
    const f = await runtimeFixture(() => postgresqlDatabase(server));
    await f.meter.license.activate('activation-secret');
    const results = await Promise.all(Array.from({ length: 6 }, () => f.runtime.run(crypto.randomUUID())));
    expect(results.filter((result) => result.status === 'succeeded')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: 'conflict' }]);
    expect(f.dispatched).toHaveLength(5);
    expect(await f.reconcile()).toMatchObject({ inspected: 5, settled: 5, pending: 0, failed: 0 });
    await f.meter.maintain();
    expect(f.received[0]?.charges).toHaveLength(5);
    expect((await f.meter.capacity())?.counters).toMatchObject([{ committedUnits: 5_000_000n, reservedUnits: 0n }]);
    expect(f.runtime.reported()).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });
});
