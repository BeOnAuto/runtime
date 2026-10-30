import { describe } from 'vitest';

import { datasetEdgesSuite } from '../dataset-testing/dataset-edges-suite.ts';
import { datasetLifecycleSuite } from '../dataset-testing/dataset-lifecycle-suite.ts';
import { onSQLite } from '../dataset-testing/dataset-stores.ts';
import { datasetFoldingSuite } from '../dataset-testing/dataset-suite.ts';
import { datasetWritesSuite } from '../dataset-testing/dataset-writes-suite.ts';
import { datasetFilesBoundsSuite } from '../dataset-testing/files-bounds-suite.ts';
import { datasetFilesSuite } from '../dataset-testing/files-suite.ts';

describe('the datasets of prediction functions on SQLite', () => {
  datasetFoldingSuite(onSQLite);
  datasetLifecycleSuite(onSQLite);
  datasetFilesSuite(onSQLite);
  datasetFilesBoundsSuite(onSQLite);
  datasetEdgesSuite(onSQLite);
  datasetWritesSuite(onSQLite);
});
