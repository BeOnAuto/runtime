import { queuedStartsSuite } from '../suite-testing/queued-starts-suite.ts';
import { onPostgreSQLAt } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

describeOnPostgreSQL('the starts of a workflow queued for a later minute', (aDatabase) => {
  queuedStartsSuite(async () => onPostgreSQLAt(await aDatabase()));
});
