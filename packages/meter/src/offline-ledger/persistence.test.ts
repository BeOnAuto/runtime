import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openOfflineMeter } from '../index.ts';
import { offlineFixture, reserveRequest } from '../offline-testing/fixture.ts';
import { offlinePersistenceBehaviour } from '../offline-testing/persistence-behaviour.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('SQLite offline atomicity', () => {
  offlinePersistenceBehaviour(sqliteDatabase);
});
const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('PostgreSQL offline atomicity', () => {
  offlinePersistenceBehaviour(() => postgresqlDatabase(server));
});

describe('bounded offline retries', () => {
  it('refuses exhausted allocation revisions before changing any hold', async () => {
    const f = await offlineFixture();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET revision = 9007199254740991`);
    await expect(f.meter.reserve(await reserveRequest())).rejects.toThrow('offline_accounting_exhausted');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_local_commands`)).toEqual([]);
  });

  it('bounds persistent contention instead of spinning or admitting unreserved work', async () => {
    const f = await offlineFixture();
    const meter = await openOfflineMeter({
      ...f.options,
      connection: { ...f.options.connection, transaction: () => Promise.resolve([]) },
    });
    await expect(meter.reserve(await reserveRequest())).rejects.toThrow('offline_accounting_contended');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_local_commands`)).toEqual([]);
  });

  it('recovers when another replica commits the same full-capacity hold just after command lookup', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest('full', 5n);
    const meter = await openOfflineMeter({
      ...f.options,
      connection: afterCommandLookup(f.options.connection, () => f.meter.reserve(request)),
    });
    expect(await meter.reserve(request)).toMatchObject({ status: 'existing', units: 5_000_000n });
    expect(await f.options.connection.read(statement`SELECT id FROM meter_local_commands`)).toHaveLength(1);
  });
});

function afterCommandLookup(connection: ConnectionPorts, action: () => Promise<unknown>): ConnectionPorts {
  let committed = false;
  return {
    ...connection,
    read: async (sql) => {
      const rows = await connection.read(sql);
      if (!committed && sql.strings.join('').includes('FROM meter_local_commands')) {
        committed = true;
        await action();
      }
      return rows;
    },
  };
}
