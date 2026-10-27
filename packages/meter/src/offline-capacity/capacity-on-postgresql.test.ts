import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { capacityBehaviour } from '../testing/capacity-behaviour.ts';
import { capacityFixture } from '../testing/capacity-fixture.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('offline source capacity shared by PostgreSQL replicas', () => {
  capacityBehaviour(() => postgresqlDatabase(server));

  it('refuses truncating allocation and source evidence', async () => {
    const f = await capacityFixture(() => postgresqlDatabase(server));
    await f.capacity.install(f.token);
    await expect(f.options.connection.write(statement`TRUNCATE meter_capacity_history CASCADE`)).rejects.toThrow(
      'Offline capacity evidence is immutable',
    );
    await expect(f.options.connection.write(statement`TRUNCATE meter_capacity_sources CASCADE`)).rejects.toThrow(
      'Offline capacity evidence is immutable',
    );
  });
});
