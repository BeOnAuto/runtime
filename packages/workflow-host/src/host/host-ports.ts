import type { SettleRun } from '@on.auto/definitions';
import type { ContentUnavailable, Emitter, EnginePorts, Executor, Listeners, Timers } from '@on.auto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { hostPayloadsOf, type ComposedPayloads } from '../runs/run-payloads.ts';
import { ledgerRecordStore } from '../settlement/ledger-record-store.ts';
import type { HostReports } from './host-reports.ts';

export interface PortParts {
  readonly settle: SettleRun;
  readonly reports: HostReports;
  readonly timers: Timers;
  readonly executor: Executor;
  readonly listeners: Listeners;
  readonly emitter: Emitter;
  readonly context: ComposedPayloads['context'];
  readonly sharedPayloads: ComposedPayloads['shared'];
  readonly now: () => number;
}

export function hostPortsOn(
  database: HostDatabase,
  { settle, reports, timers, executor, listeners, emitter, context, sharedPayloads, now }: PortParts,
): EnginePorts<ContentUnavailable> {
  return {
    runStore: ledgerRunLogStore(database),
    payloads: hostPayloadsOf({ content: database.content, context, shared: sharedPayloads, note: reports.note }),
    watermark: sqlWatermark(database),
    timers,
    executor,
    listeners,
    emitter,
    recordStore: ledgerRecordStore(database, { settle, note: reports.note, now }),
    reporter: {
      unsettled: ({ run, receipt }) => reports.unsettled({ ...addressOfRun(run.runId), receipt }),
      reloaded: ({ runId, ...reloaded }) =>
        reports.note({ kind: 'run_reloaded', run: addressOfRun(runId), ...reloaded }),
    },
    serialiser: runSerialiser(),
  };
}
