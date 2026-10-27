import { describe } from 'vitest';

import { capacityBehaviour } from '../testing/capacity-behaviour.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('offline source capacity on SQLite', () => {
  capacityBehaviour(sqliteDatabase);
});
