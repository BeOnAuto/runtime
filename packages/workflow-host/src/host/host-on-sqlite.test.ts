import { describe } from 'vitest';

import { reactionSuite } from '../reaction-testing/reaction-suite.ts';
import { dispatchSuite } from '../suite-testing/dispatch-suite.ts';
import { failureSuite } from '../suite-testing/failure-suite.ts';
import { claimSuite, leaseSuite } from '../suite-testing/lease-suite.ts';
import { longRunSuite } from '../suite-testing/long-run-suite.ts';
import { portSuite } from '../suite-testing/port-suite.ts';
import { runSuite } from '../suite-testing/run-suite.ts';
import { onSQLite } from '../testing/host-files.ts';

describe('the host on SQLite', () => {
  describe('its ports', () => {
    portSuite(onSQLite);
  });

  describe('a workflow it runs', () => {
    runSuite(onSQLite);
  });

  describe('its waiting calls, dispatched again', () => {
    dispatchSuite(onSQLite);
  });

  describe('a long run', () => {
    longRunSuite(onSQLite);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(onSQLite);
  });

  describe('the reactions of its playbooks', () => {
    reactionSuite(onSQLite);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(onSQLite);
    claimSuite(onSQLite, 'host');
  });
});
