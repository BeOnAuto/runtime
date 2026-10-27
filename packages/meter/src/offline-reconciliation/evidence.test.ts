import { statementOf } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { assertOfflineConservation, dispatchRequest, reserveRequest } from '../offline-testing/fixture.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

const tables = ['meter_local_reports', 'meter_report_receipts', 'meter_close_requests'];

async function populated(open: () => Promise<MeterDatabase>) {
  const f = await reportingFixture(open);
  const request = await reserveRequest();
  const hold = await f.meter.reserve(request);
  await f.meter.commitDispatch(dispatchRequest(hold, request));
  await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
  await f.reporter.requestClose(f.allocation.id);
  await f.reporter.send();
  return f;
}

function immutableReports(open: () => Promise<MeterDatabase>): void {
  it.each(tables)('refuses rewriting and deleting %s', async (table) => {
    const f = await populated(open);
    await expect(
      f.options.connection.write(statementOf([`UPDATE ${table} SET allocation_id = allocation_id`], [])),
    ).rejects.toThrow('Offline accounting evidence is immutable');
    await expect(f.options.connection.write(statementOf([`DELETE FROM ${table}`], []))).rejects.toThrow(
      'Offline accounting evidence is immutable',
    );
    await assertOfflineConservation(f.options.connection);
  });
}

describe('immutable SQLite report evidence', () => {
  immutableReports(sqliteDatabase);
  it.each(tables)('refuses replacing %s', async (table) => {
    const f = await populated(sqliteDatabase);
    await expect(
      f.options.connection.write(statementOf([`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`], [])),
    ).rejects.toThrow('Offline accounting evidence is immutable');
    await assertOfflineConservation(f.options.connection);
  });
});

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('immutable PostgreSQL report evidence', () => {
  immutableReports(() => postgresqlDatabase(server));
  it.each(tables)('refuses truncating %s', async (table) => {
    const f = await populated(() => postgresqlDatabase(server));
    await expect(f.options.connection.write(statementOf([`TRUNCATE ${table} CASCADE`], []))).rejects.toThrow(
      'Offline accounting evidence is immutable',
    );
    await assertOfflineConservation(f.options.connection);
  });
});
