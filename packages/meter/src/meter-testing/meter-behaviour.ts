import { describe } from 'vitest';

import { allocationsBehaviour } from './allocation-behaviour.ts';
import { allowanceBehaviour, concurrencyBehaviour } from './allowance-behaviour.ts';
import { countingBehaviour, historyBehaviour } from './counting-behaviour.ts';
import { licensesBehaviour } from './license-behaviour.ts';
import type { LedgerOf } from './opened.ts';
import { earlyReportBehaviour, reportBehaviour, restoredReportBehaviour } from './report-behaviour.ts';
import { statusBehaviour } from './status-behaviour.ts';

export function meterBehaviour(name: string, ledgerOf: LedgerOf): void {
  describe(`the meter on ${name}`, () => {
    describe('counting', () => {
      countingBehaviour(ledgerOf);
    });
    describe('the history of its runs', () => {
      historyBehaviour(ledgerOf);
    });
    describe('its free runs', () => {
      allowanceBehaviour(ledgerOf);
      concurrencyBehaviour(ledgerOf);
    });
    describe('licenses', () => {
      licensesBehaviour(ledgerOf);
    });
    describe('allocations', () => {
      allocationsBehaviour(ledgerOf);
    });
    describe('reports', () => {
      reportBehaviour(ledgerOf);
      earlyReportBehaviour(ledgerOf);
      restoredReportBehaviour(ledgerOf);
    });
    describe('its license status', () => {
      statusBehaviour(ledgerOf);
    });
  });
}
