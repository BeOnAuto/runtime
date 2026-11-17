import { describe } from 'vitest';

import {
  attemptLeaseSuite,
  handedOverLeaseSuite,
  lapsedLeaseSuite,
  liveHolderSuite,
} from '../suite-testing/attempt-lease-suite.ts';
import {
  systemClockLeaseSuite,
  tokenlessBesideLeaseSuite,
  tokenlessLeaseSuite,
} from '../suite-testing/tokenless-lease-suite.ts';
import { onPostgreSQLAt } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

describeOnPostgreSQL('the lease of an attempt', (aDatabase) => {
  const onPostgreSQL = async () => onPostgreSQLAt(await aDatabase());

  attemptLeaseSuite(onPostgreSQL);
  liveHolderSuite(onPostgreSQL);
  lapsedLeaseSuite(onPostgreSQL);
  handedOverLeaseSuite(onPostgreSQL);
  systemClockLeaseSuite(onPostgreSQL);

  describe('that names no token yet', () => {
    tokenlessLeaseSuite(onPostgreSQL);
    tokenlessBesideLeaseSuite(onPostgreSQL);
  });
});
