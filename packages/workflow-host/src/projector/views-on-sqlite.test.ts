import { describe } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { viewsSuites } from '../views-testing/views-suites.ts';

describe('the views of recall functions on SQLite', () => {
  viewsSuites(onSQLite);
});
