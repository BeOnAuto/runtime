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
import { onASQLiteFile } from '../testing/host-files.ts';

describe('the lease of an attempt on SQLite', () => {
  attemptLeaseSuite(onASQLiteFile);
  liveHolderSuite(onASQLiteFile);
  lapsedLeaseSuite(onASQLiteFile);
  handedOverLeaseSuite(onASQLiteFile);
  systemClockLeaseSuite(onASQLiteFile);
});

describe('the lease of an attempt that names no token yet, on SQLite', () => {
  tokenlessLeaseSuite(onASQLiteFile);
  tokenlessBesideLeaseSuite(onASQLiteFile);
});
