import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { runQuote, type AllocatedSource, type QuoteContext, type WorkBound } from '@on.auto/metering';
import { expect } from 'vitest';

import {
  openOfflineMeter,
  type OfflineDispatchRequest,
  type OfflineReceipt,
  type OfflineReserveRequest,
} from '../index.ts';
import { capacityFixture } from '../testing/capacity-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

export async function reserveRequest(
  runId = 'run-1',
  count = 1n,
  changes: Partial<QuoteContext> = {},
): Promise<OfflineReserveRequest> {
  const context: QuoteContext = {
    run: { accountId: 'account-1', deploymentId: 'installation-1', playbookId: 'playbook-1', runId },
    definitionVersion: 'version-1',
    inputDigest: 'a'.repeat(64),
    limitsDigest: 'b'.repeat(64),
    expiresAt: 9000,
    ...changes,
  };
  const plan: WorkBound = {
    type: 'repeat',
    iterations: count,
    body: { type: 'run', resources: [], developmentUnits: 0n },
  };
  return { context, plan, quote: await runQuote(context, plan, 5000), capabilities: ['reasoning'] };
}

export function dispatchRequest(
  receipt: OfflineReceipt,
  request: OfflineReserveRequest,
  runId = request.context.run.runId,
): OfflineDispatchRequest {
  return {
    reservationId: receipt.reservationId,
    run: { ...request.context.run, runId },
    capability: 'reasoning',
    evidenceDigest: 'c'.repeat(64),
  };
}

export async function offlineFixture(open = sqliteDatabase, sources?: readonly AllocatedSource[]) {
  const f = await capacityFixture(open);
  const token = sources === undefined ? f.token : await f.authorize({ ...f.allocation, sources });
  await f.capacity.install(token);
  const meter = await openOfflineMeter(f.options);
  async function replica() {
    const database = await f.database.reopen();
    return openOfflineMeter({ ...f.options, connection: database.connection });
  }
  return { ...f, meter, replica };
}

export async function assertOfflineConservation(connection: ConnectionPorts): Promise<void> {
  expect(
    await connection.read(statement`SELECT u.lot_id FROM meter_capacity_usage u WHERE
    u.reserved_units <> COALESCE((SELECT SUM(e.reserved_delta) FROM meter_local_entries e WHERE e.allocation_id = u.allocation_id AND e.lot_id = u.lot_id), 0)
    OR u.committed_units <> COALESCE((SELECT SUM(e.committed_delta) FROM meter_local_entries e WHERE e.allocation_id = u.allocation_id AND e.lot_id = u.lot_id), 0)`),
  ).toEqual([]);
  expect(
    await connection.read(statement`SELECT u.lot_id FROM meter_capacity_usage u WHERE
    u.reserved_units <> COALESCE((SELECT SUM(p.reserved_units) FROM meter_reservation_usage p JOIN meter_reservations r ON r.id = p.reservation_id WHERE r.allocation_id = u.allocation_id AND p.lot_id = u.lot_id), 0)
    OR u.committed_units <> COALESCE((SELECT SUM(p.units) FROM meter_offline_charge_parts p WHERE p.allocation_id = u.allocation_id AND p.lot_id = u.lot_id), 0)`),
  ).toEqual([]);
}
