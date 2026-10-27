import { describe } from 'vitest';

import { licenseClientBehaviour } from '../testing/license-client-behaviour.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('the durable license client on SQLite', () => {
  licenseClientBehaviour(sqliteDatabase);
});
