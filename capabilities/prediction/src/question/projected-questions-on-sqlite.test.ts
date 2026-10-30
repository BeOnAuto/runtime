import { describe } from 'vitest';

import { onSQLite } from '../dataset-testing/dataset-stores.ts';
import { projectedQuestionsSuite } from '../question-testing/projected-questions-suite.ts';

describe('the questions to prediction functions over projected datasets on SQLite', () => {
  projectedQuestionsSuite(onSQLite);
});
