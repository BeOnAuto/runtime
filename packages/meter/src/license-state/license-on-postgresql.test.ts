import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { licenseStateBehaviour } from '../testing/license-state-behaviour.ts';
import { licenseStateFixture } from '../testing/license-state-fixture.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

describe.skipIf(server === '')('durable license state shared by PostgreSQL replicas', () => {
  licenseStateBehaviour(() => postgresqlDatabase(server));
  it('refuses truncating accepted license history', async () => {
    const f = await licenseStateFixture(() => postgresqlDatabase(server));
    await f.state.record(f.request);
    await expect(f.database.connection.write(statement`TRUNCATE meter_license_history`)).rejects.toThrow(
      'License history is immutable',
    );
  });
});
