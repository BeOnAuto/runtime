import { describe } from 'vitest';

import { allocationsBehaviour } from './allocation-behaviour.ts';
import { allowanceBehaviour, concurrencyBehaviour } from './allowance-behaviour.ts';
import { checkpointBehaviour, verificationBehaviour } from './checkpoint-behaviour.ts';
import { countingBehaviour, recountingBehaviour } from './counting-behaviour.ts';
import { faultBehaviour, rebuildingBehaviour } from './fault-behaviour.ts';
import {
  activationBehaviour,
  invalidLicenseBehaviour,
  keyBehaviour,
  licensedAdmissionBehaviour,
  refreshBehaviour,
  revocationBehaviour,
} from './license-behaviour.ts';
import type { LedgerOf } from './opened.ts';
import { repairBehaviour } from './repair-behaviour.ts';
import { reportBehaviour, reportVerificationBehaviour } from './report-behaviour.ts';

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
      faultBehaviour(ledgerOf);
      repairBehaviour(ledgerOf);
    });
    describe('allowances', () => {
      allowanceBehaviour(ledgerOf);
      concurrencyBehaviour(ledgerOf);
    });
    describe('licenses', () => {
      activationBehaviour(ledgerOf);
      keyBehaviour(ledgerOf);
      refreshBehaviour(ledgerOf);
      invalidLicenseBehaviour(ledgerOf);
      revocationBehaviour(ledgerOf);
      licensedAdmissionBehaviour(ledgerOf);
    });
    describe('allocations', () => {
      allocationsBehaviour(ledgerOf);
    });
    describe('reports', () => {
      reportBehaviour(ledgerOf);
      reportVerificationBehaviour(ledgerOf);
    });
  });
}
