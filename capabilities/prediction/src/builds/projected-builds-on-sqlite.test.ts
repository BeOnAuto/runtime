import { describe } from 'vitest';

import { projectedBuildsSuite } from '../build-testing/projected-builds-suite.ts';
import { projectedLicensedSuite } from '../build-testing/projected-licensed-suite.ts';
import { projectedQuestionsSuite } from '../build-testing/projected-questions-suite.ts';
import { onSQLite } from '../dataset-testing/dataset-stores.ts';

describe('the builds of prediction functions over projected datasets on SQLite', () => {
  projectedBuildsSuite(onSQLite);
  projectedLicensedSuite(onSQLite);
  projectedQuestionsSuite(onSQLite);
});
