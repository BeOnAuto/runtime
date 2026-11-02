import { describe } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { viewsSuites } from '../views-testing/views-suites.ts';

describe('the views of the projector on SQLite', () => {
  viewsSuites(onSQLite);
});
