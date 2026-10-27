import { describe } from 'vitest';

import { allowanceBehaviour, concurrencyBehaviour } from './allowance-behaviour.ts';
import { checkpointBehaviour, verificationBehaviour } from './checkpoint-behaviour.ts';
import { countingBehaviour, recountingBehaviour } from './counting-behaviour.ts';
import { faultBehaviour, rebuildingBehaviour } from './fault-behaviour.ts';
import type { LedgerOf } from './opened.ts';

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
    });
    describe('allowances', () => {
      allowanceBehaviour(ledgerOf);
      concurrencyBehaviour(ledgerOf);
    });
  });
}
