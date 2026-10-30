import type { SettleRun } from '@on.auto/definitions';
import type { Emitter, EnginePorts, Executor, Listeners, Timers } from '@on.auto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';
import type { HostReports } from './host-reports.ts';

export interface PortParts {
  readonly settle: SettleRun;
  readonly reports: HostReports;
  readonly timers: Timers;
  readonly executor: Executor;
  readonly listeners: Listeners;
  readonly emitter: Emitter;
  readonly now: () => number;
}

export function hostPortsOn(
  database: HostDatabase,
  { settle, reports, timers, executor, listeners, emitter, now }: PortParts,
): EnginePorts {
  return {
    runStore: ledgerRunLogStore(database),
    watermark: sqlWatermark(database),
    timers,
    executor,
    listeners,
    emitter,
    recordStore: ledgerRecordStore(database, { settle, note: reports.note, now }),
    reporter: { unsettled: ({ run, receipt }) => reports.unsettled({ ...addressOfRun(run.runId), receipt }) },
    serialiser: runSerialiser(),
  };
}
