import { describe } from 'vitest';

import { foldersSuite } from '../folder-testing/folders-suite.ts';
import { laggingSuite } from '../folder-testing/lagging-suite.ts';
import { missingOutputsSuite } from '../folder-testing/missing-outputs-suite.ts';
import { onSQLite } from '../testing/host-files.ts';

describe('the folders of the projector on SQLite', () => {
  foldersSuite(onSQLite);
  laggingSuite(onSQLite);
  missingOutputsSuite(onSQLite);
});
