import { describe } from 'vitest';

import { closingSuite } from '../closing-testing/closing-suite.ts';
import { onSQLite } from '../testing/host-files.ts';

describe('the calls of a run that ended, closed by the host on SQLite', () => {
  closingSuite(onSQLite);
});
