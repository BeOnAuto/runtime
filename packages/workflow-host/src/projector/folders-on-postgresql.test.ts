import { foldersSuite } from '../folder-testing/folders-suite.ts';
import { onPostgreSQLAt } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

describeOnPostgreSQL('the folders of the projector', (aDatabase) => {
  foldersSuite(async () => onPostgreSQLAt(await aDatabase()));
});
