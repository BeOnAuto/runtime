import { describe } from 'vitest';

import { heldPlaybookSuite } from '../reaction-testing/held-playbook-suite.ts';
import { heldWakeSuite } from '../reaction-testing/held-wake-suite.ts';
import { unreadableFactSuite } from '../reaction-testing/unreadable-fact-suite.ts';
import { onASQLiteFile } from '../testing/host-files.ts';

describe('a playbook whose follower is held at a record', () => {
  heldPlaybookSuite(onASQLiteFile);
  unreadableFactSuite(onASQLiteFile);
  heldWakeSuite(onASQLiteFile);
});
