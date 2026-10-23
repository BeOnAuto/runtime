import type { LedgerServices } from '@on.auto/ledger';
import { IncidentReporter } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { logIncident } from '../logging/logging.ts';
import type { ServerServices } from '../server-options/composed-options.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<LedgerServices>): Layer.Layer<ServerServices> {
  return Layer.mergeAll(ledger, ledgerPlaybookRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}
