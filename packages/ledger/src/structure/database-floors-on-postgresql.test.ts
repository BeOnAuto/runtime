import { runTallyRows } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { ledgerLayout } from '../layout/ledger-layout.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import {
  aPostgreSQLDatabaseFrom,
  aPostgreSQLDatabaseOfTheStore,
  postgresqlLayoutDumpOf,
  structureOfThePostgreSQLDatabase,
} from './database-floors.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

async function aLedgerOpenedOn(database: string): Promise<void> {
  const { dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), projections: [runTallyRows] }),
  );
  await dispose();
}

describe.skipIf(skipped)(`The floor of a ledger on PostgreSQL${notice}`, () => {
  it('holds the tables and indexes of the layout apart from those of the store, and makes the database again in the structure the ledger left', async () => {
    const [ledger, storeAlone, made] = [await aDatabase(), await aDatabase(), await aDatabase()];
    await aLedgerOpenedOn(ledger);
    await aPostgreSQLDatabaseOfTheStore(storeAlone);

    const floor = await postgresqlLayoutDumpOf(ledger, storeAlone);
    await aPostgreSQLDatabaseFrom(floor, made);

    expect(floor).toMatchObject({
      layout: ledgerLayout,
      kept: [{ table: 'ledger_layout', rows: [{ layout: ledgerLayout }] }],
    });
    expect(floor.made.filter((statement) => statement.startsWith('CREATE TABLE emt_'))).toEqual([]);
    expect(floor.made.some((statement) => statement.startsWith(`CREATE TABLE ${runTallyRows.name}_`))).toBe(true);
    expect(await structureOfThePostgreSQLDatabase(made)).toEqual(await structureOfThePostgreSQLDatabase(ledger));
    expect(await postgresqlLayoutDumpOf(made, storeAlone)).toEqual(floor);
  });
});
