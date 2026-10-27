import { statement, statementOf } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import {
  assertOfflineConservation,
  dispatchRequest,
  offlineFixture,
  reserveRequest,
} from '../offline-testing/fixture.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { postgresqlDatabase } from '../testing/postgresql-database.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

const tables = [
  ['meter_local_commands', 'id'],
  ['meter_local_entries', 'command_id'],
  ['meter_reservations', 'id'],
  ['meter_reservation_sources', 'reservation_id'],
  ['meter_offline_charges', 'id'],
  ['meter_offline_charge_parts', 'charge_id'],
];

async function populated(open: () => Promise<MeterDatabase>) {
  const f = await offlineFixture(open);
  const request = await reserveRequest('root', 2n);
  const hold = await f.meter.reserve(request);
  await f.meter.commitDispatch(dispatchRequest(hold, request));
  await f.meter.release({ reservationId: hold.reservationId, reason: 'completed', evidenceDigest: 'd'.repeat(64) });
  return f;
}

function immutableEvidence(open: () => Promise<MeterDatabase>): void {
  it.each(tables)('refuses edits and deletion of %s', async (table, column) => {
    const f = await populated(open);
    await expect(
      f.options.connection.write(statementOf([`UPDATE ${table} SET ${column} = ${column}`], [])),
    ).rejects.toThrow('Offline accounting evidence is immutable');
    await expect(f.options.connection.write(statementOf([`DELETE FROM ${table}`], []))).rejects.toThrow(
      'Offline accounting evidence is immutable',
    );
    await assertOfflineConservation(f.options.connection);
  });

  it('constrains hold projections to immutable source quantities and conservation', async () => {
    const f = await populated(open);
    await expect(
      f.options.connection.write(
        statement`UPDATE meter_reservation_usage SET capacity_units = capacity_units + 1, released_units = released_units + 1`,
      ),
    ).rejects.toThrow(/foreign key/iu);
    await expect(
      f.options.connection.write(statement`UPDATE meter_reservation_usage SET released_units = released_units + 1`),
    ).rejects.toThrow(/constraint|CHECK/iu);
    await expect(
      f.options.connection.write(statement`UPDATE meter_reservation_usage SET committed_units = -1`),
    ).rejects.toThrow(/constraint|CHECK/iu);
    await assertOfflineConservation(f.options.connection);
  });
}

function chargeCommandEvidence(open: () => Promise<MeterDatabase>): void {
  it('refuses orphaned charges that cannot be reconciled to a durable dispatch command', async () => {
    const f = await populated(open);
    await expect(
      f.options.connection.write(statement`INSERT INTO meter_offline_charges
      (id, command_id, reservation_id, allocation_id, playbook_id, run_id, capability, evidence_digest, admitted_at, committed_at)
      SELECT 'orphan-charge', 'missing-command', reservation_id, allocation_id, playbook_id, 'orphan-run', capability,
        evidence_digest, admitted_at, committed_at FROM meter_offline_charges`),
    ).rejects.toThrow(/foreign key/iu);
    expect(
      await f.options.connection.read(statement`SELECT id FROM meter_offline_charges WHERE id = 'orphan-charge'`),
    ).toEqual([]);
    await assertOfflineConservation(f.options.connection);
  });
}

describe('immutable SQLite offline accounting', () => {
  immutableEvidence(sqliteDatabase);
  chargeCommandEvidence(sqliteDatabase);
  it.each(tables)('refuses replacing %s', async (table) => {
    const f = await populated(sqliteDatabase);
    await expect(
      f.options.connection.write(statementOf([`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`], [])),
    ).rejects.toThrow('Offline accounting evidence is immutable');
  });
});

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';
describe.skipIf(server === '')('immutable PostgreSQL offline accounting', () => {
  immutableEvidence(() => postgresqlDatabase(server));
  chargeCommandEvidence(() => postgresqlDatabase(server));
  it.each(tables)('refuses truncating %s', async (table) => {
    const f = await populated(() => postgresqlDatabase(server));
    await expect(f.options.connection.write(statementOf([`TRUNCATE ${table} CASCADE`], []))).rejects.toThrow(
      'Offline accounting evidence is immutable',
    );
  });
});
