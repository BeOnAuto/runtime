import { describe } from 'vitest';

import { allocationsBehaviour } from './allocation-behaviour.ts';
import { allowanceBehaviour, concurrencyBehaviour, laggingClockBehaviour } from './allowance-behaviour.ts';
import { historyBehaviour, runsBehaviour } from './counting-behaviour.ts';
import { featuresBehaviour } from './features-behaviour.ts';
import { goalNoticeBehaviour } from './goal-notice-behaviour.ts';
import { licensesBehaviour } from './license-behaviour.ts';
import type { DatabaseOf, LedgerOf } from './opened.ts';
import { earlyReportBehaviour, reportBehaviour } from './report-behaviour.ts';
import { statusBehaviour } from './status-behaviour.ts';

export function meterOnADatabaseBehaviour(name: string, databaseOf: DatabaseOf): void {
  describe(`the meter on ${name}, as replicas and their clocks meet in one database, and as its rows are changed under it`, () => {
    laggingClockBehaviour(databaseOf);
    concurrencyBehaviour(databaseOf);
    historyBehaviour(databaseOf);
  });
}

export function meterBehaviour(name: string, ledgerOf: LedgerOf): void {
  describe(`the meter on ${name}`, () => {
    runsBehaviour(ledgerOf);
    describe('its free runs', () => {
      allowanceBehaviour(ledgerOf);
      laggingClockBehaviour(ledgerOf);
    });
    describe('goal notices', () => {
      goalNoticeBehaviour(ledgerOf);
    });
    describe('licenses', () => {
      licensesBehaviour(ledgerOf);
    });
    describe('the features of its license', () => {
      featuresBehaviour(ledgerOf);
    });
    describe('allocations', () => {
      allocationsBehaviour(ledgerOf);
    });
    describe('reports', () => {
      reportBehaviour(ledgerOf);
      earlyReportBehaviour(ledgerOf);
    });
    describe('its license status', () => {
      statusBehaviour(ledgerOf);
    });
  });
}
