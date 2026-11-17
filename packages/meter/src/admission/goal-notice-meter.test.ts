import { describe } from 'vitest';

import { goalNoticeBehaviour } from '../meter-testing/goal-notice-behaviour.ts';
import { sqliteLedger } from '../testing/ledgers.ts';

describe('goal notices on SQLite', () => {
  goalNoticeBehaviour(() => Promise.resolve(sqliteLedger()));
});
