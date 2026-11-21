import { describe } from 'vitest';

import { allocationReplicasBehaviour } from './allocation-behaviour.ts';
import { restoredAllocationReportBehaviour } from './allocation-report-behaviour.ts';
import { replicasCountingBehaviour } from './counting-behaviour.ts';
import { unreadFeaturesBehaviour } from './features-behaviour.ts';
import { admittedWhereFiled, countedWhereFiled } from './filed-runs-behaviour.ts';
import { wipedLicenseBehaviour } from './license-behaviour.ts';
import type { DatabaseOf } from './opened.ts';
import { releasedFactsBehaviour } from './released-facts-behaviour.ts';
import { restoredReportBehaviour } from './report-behaviour.ts';

export function meterOnItsRowsBehaviour(name: string, databaseOf: DatabaseOf): void {
  describe(`the meter on ${name}, as replicas meet in its rows and as its rows are read and changed under it`, () => {
    replicasCountingBehaviour(databaseOf);
    allocationReplicasBehaviour(databaseOf);
    describe('runs filed under their definitions', () => {
      admittedWhereFiled(databaseOf);
      countedWhereFiled(databaseOf);
    });
    wipedLicenseBehaviour(databaseOf);
    unreadFeaturesBehaviour(databaseOf);
    restoredAllocationReportBehaviour(databaseOf);
    restoredReportBehaviour(databaseOf);
    describe('the facts earlier releases recorded', () => {
      releasedFactsBehaviour(databaseOf);
    });
  });
}
