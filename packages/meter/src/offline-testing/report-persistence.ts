import { statement, statementOf } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter, type OfflineReporter } from '../index.ts';
import type { MeterDatabase } from '../testing/database.ts';
import { reportingFixture } from './report-fixture.ts';

type ReportOperation = 'prepare' | 'close' | 'acknowledge';

async function preparedAction(reporter: OfflineReporter, id: string, operation: ReportOperation) {
  if (operation === 'prepare') return (next: OfflineReporter) => next.prepare();
  if (operation === 'close') return (next: OfflineReporter) => next.requestClose(id);
  await reporter.requestClose(id);
  await reporter.prepare();
  return (next: OfflineReporter) => next.send();
}

export function reportPersistenceBehaviour(open: () => Promise<MeterDatabase>): void {
  describe('uncertain report storage outcomes', () => {
    lostAcknowledgements(open);
    rolledBackReports(open);
  });
}

function lostAcknowledgements(open: () => Promise<MeterDatabase>): void {
  it.each<ReportOperation>(['prepare', 'close', 'acknowledge'])(
    'recovers durable %s state after a lost storage acknowledgement',
    async (operation) => {
      const f = await reportingFixture(open);
      const action = await preparedAction(f.reporter, f.allocation.id, operation);
      const reporter = await openOfflineReporter({
        ...f.reporting,
        connection: {
          ...f.options.connection,
          transaction: async (sql) => {
            await f.options.connection.transaction(sql);
            throw new Error('acknowledgement_lost');
          },
        },
      });
      expect(await action(reporter)).toBeDefined();
      const tables = {
        prepare: 'meter_local_reports',
        close: 'meter_close_requests',
        acknowledge: 'meter_report_receipts',
      };
      expect(await f.options.connection.read(statementOf([`SELECT * FROM ${tables[operation]}`], []))).toHaveLength(1);
    },
  );
}

function rolledBackReports(open: () => Promise<MeterDatabase>): void {
  it.each<ReportOperation>(['prepare', 'close', 'acknowledge'])(
    'rolls back every %s write on a late SQL failure',
    async (operation) => {
      const f = await reportingFixture(open);
      const action = await preparedAction(f.reporter, f.allocation.id, operation);
      const before = await f.capacity.snapshot();
      const pending = await f.reporter.pending();
      const reporter = await openOfflineReporter({
        ...f.reporting,
        connection: {
          ...f.options.connection,
          transaction: (sql) =>
            f.options.connection.transaction([...sql, statement`INSERT INTO missing_report_table VALUES (1)`]),
        },
      });
      await expect(action(reporter)).rejects.toThrow('missing_report_table');
      expect(await f.capacity.snapshot()).toEqual(before);
      expect(await f.reporter.pending()).toEqual(pending);
      expect(await action(f.reporter)).toBeDefined();
    },
  );
}
