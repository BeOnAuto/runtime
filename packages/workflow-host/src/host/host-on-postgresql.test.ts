import { describe } from 'vitest';

import { failureSuite } from '../suite-testing/failure-suite.ts';
import { leaseSuite } from '../suite-testing/lease-suite.ts';
import { portSuite } from '../suite-testing/port-suite.ts';
import { databaseSettingsOf, type ProcessDatabasesOf } from '../testing/host-processes.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

describeOnPostgreSQL('the host', (aDatabase) => {
  const processDatabase: ProcessDatabasesOf = async () => ({
    store: 'postgresql',
    connectionString: await aDatabase(),
  });
  const onPostgreSQL = async () => databaseSettingsOf(await processDatabase());

  describe('its ports', () => {
    portSuite(onPostgreSQL);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(processDatabase);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(processDatabase, 'database');
  });
});
