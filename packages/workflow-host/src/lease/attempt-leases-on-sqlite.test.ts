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
import { onSQLite } from '../testing/host-files.ts';

describe('the lease of an attempt on SQLite', () => {
  attemptLeaseSuite(onSQLite);
  liveHolderSuite(onSQLite);
  lapsedLeaseSuite(onSQLite);
  handedOverLeaseSuite(onSQLite);
  systemClockLeaseSuite(onSQLite);
});

describe('the lease of an attempt that names no token yet, on SQLite', () => {
  tokenlessLeaseSuite(onSQLite);
  tokenlessBesideLeaseSuite(onSQLite);
});
