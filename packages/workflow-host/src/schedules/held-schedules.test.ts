import { describe } from 'vitest';

import { heldScheduleSuite } from '../reaction-testing/held-schedule-suite.ts';
import { onSQLite } from '../testing/host-files.ts';

describe('a due time of a schedule whose workflow could not be read from storage', () => {
  heldScheduleSuite(onSQLite);
});
