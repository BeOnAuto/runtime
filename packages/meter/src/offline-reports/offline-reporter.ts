import { prepareMeter } from '../database/schema.ts';
import { requestOfflineClose } from '../offline-reconciliation/closing.ts';
import { reportSender } from '../offline-reconciliation/delivery.ts';
import { pendingOfflineReport, prepareOfflineReport } from './preparation.ts';
import type { OfflineReporter, OfflineReporterOptions } from './records.ts';

export async function openOfflineReporter(options: OfflineReporterOptions): Promise<OfflineReporter> {
  const captured = {
    ...options,
    authority: { ...options.authority },
    installation: { ...options.installation, publicKey: { ...options.installation.publicKey } },
  };
  const send = reportSender(captured);
  await prepareMeter(captured.connection);
  return {
    prepare: () => prepareOfflineReport(captured),
    pending: () => pendingOfflineReport(captured),
    requestClose: (allocationId) => requestOfflineClose(captured.connection, allocationId),
    send,
  };
}
