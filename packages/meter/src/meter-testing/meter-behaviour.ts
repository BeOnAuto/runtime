import { describe } from 'vitest';

import { allocationsBehaviour } from './allocation-behaviour.ts';
import { allowanceBehaviour, concurrencyBehaviour } from './allowance-behaviour.ts';
import { checkpointBehaviour, verificationBehaviour } from './checkpoint-behaviour.ts';
import { countingBehaviour, recountingBehaviour } from './counting-behaviour.ts';
import { faultsBehaviour, rebuildingBehaviour } from './fault-behaviour.ts';
import { licensesBehaviour } from './license-behaviour.ts';
import type { LedgerOf } from './opened.ts';
import { reportBehaviour, reportVerificationBehaviour } from './report-behaviour.ts';
import { statusBehaviour } from './status-behaviour.ts';

export function meterBehaviour(name: string, ledgerOf: LedgerOf): void {
  describe(`the meter on ${name}`, () => {
    describe('counting', () => {
      countingBehaviour(ledgerOf);
      recountingBehaviour(ledgerOf);
    });
    describe('its checkpoint', () => {
      checkpointBehaviour(ledgerOf);
      verificationBehaviour(ledgerOf);
    });
    describe('rebuilding', () => {
      rebuildingBehaviour(ledgerOf);
    });
    describe('faults', () => {
      faultsBehaviour(ledgerOf);
    });
    describe('allowances', () => {
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
      reportVerificationBehaviour(ledgerOf);
    });
    describe('its license status', () => {
      statusBehaviour(ledgerOf);
    });
  });
}
