import { describe } from 'vitest';

import { agentActionBehaviour } from './agent-action-behaviour.ts';
import { allocationsBehaviour } from './allocation-behaviour.ts';
import {
  allowanceBehaviour,
  concurrencyBehaviour,
  defaultAllowanceBehaviour,
  laggingClockBehaviour,
} from './allowance-behaviour.ts';
import { countingBehaviour, historyBehaviour, startedRunsBehaviour } from './counting-behaviour.ts';
import { featuresBehaviour } from './features-behaviour.ts';
import { licensesBehaviour } from './license-behaviour.ts';
import type { LedgerOf } from './opened.ts';
import { earlyReportBehaviour, reportBehaviour, restoredReportBehaviour } from './report-behaviour.ts';
import { statusBehaviour } from './status-behaviour.ts';

export function meterBehaviour(name: string, ledgerOf: LedgerOf): void {
  describe(`the meter on ${name}`, () => {
    describe('counting', () => {
      countingBehaviour(ledgerOf);
      startedRunsBehaviour(ledgerOf);
    });
    describe('the history of its runs', () => {
      historyBehaviour(ledgerOf);
    });
    describe('its free runs', () => {
      allowanceBehaviour(ledgerOf);
      laggingClockBehaviour(ledgerOf);
      defaultAllowanceBehaviour(ledgerOf);
      concurrencyBehaviour(ledgerOf);
    });
    describe('the actions of agents', () => {
      agentActionBehaviour(ledgerOf);
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
      restoredReportBehaviour(ledgerOf);
    });
    describe('its license status', () => {
      statusBehaviour(ledgerOf);
    });
  });
}
