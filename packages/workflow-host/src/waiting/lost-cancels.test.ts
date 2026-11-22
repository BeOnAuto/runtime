import { describe } from 'vitest';

import { onASQLiteFile } from '../testing/host-files.ts';
import { lostCancelSuite } from '../waiting-testing/lost-cancel-suite.ts';
import { endedRunSuite } from '../waiting-testing/resumed-cancels.ts';

describe('the cancels a follower passed over', () => {
  lostCancelSuite(onASQLiteFile);
  endedRunSuite(onASQLiteFile);
});
