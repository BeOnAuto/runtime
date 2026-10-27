import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openLicenseClock } from '../index.ts';
import { clockBehaviour } from '../testing/clock-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('the persisted license clock shared by PostgreSQL replicas', () => {
  clockBehaviour(() => postgresqlDatabase(server));
  it('samples the actual database time without reading the host wall clock and prevents truncating its receipts', async () => {
    const database = await postgresqlDatabase(server);
    const clock = await openLicenseClock(database.connection, {
      wallTime: () => {
        throw new Error('host_wall_clock_used');
      },
      monotonicTime: () => 0,
    });
    const trusted = await clock.synchronize({ id: 'refresh-1', serverTime: 200_000 });
    expect(trusted.onlineRequired).toBe(false);
    expect(trusted.now).toBeGreaterThanOrEqual(200_000);
    expect(trusted.now).toBeLessThan(260_000);
    await expect(database.connection.write(statement`TRUNCATE meter_clock_refreshes`)).rejects.toThrow(
      'Clock refresh receipts are immutable',
    );
  });
});
