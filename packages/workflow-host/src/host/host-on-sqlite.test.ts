import { describe } from 'vitest';

import { movedReactionsSuite } from '../reaction-testing/moved-reactions-suite.ts';
import { reactionSuite } from '../reaction-testing/reaction-suite.ts';
import { dispatchSuite } from '../suite-testing/dispatch-suite.ts';
import { failureSuite } from '../suite-testing/failure-suite.ts';
import { leaseSuite } from '../suite-testing/lease-suite.ts';
import { longRunSuite } from '../suite-testing/long-run-suite.ts';
import { portSuite } from '../suite-testing/port-suite.ts';
import { runSuite } from '../suite-testing/run-suite.ts';
import { onASQLiteFile } from '../testing/host-files.ts';

describe('the host on SQLite', () => {
  describe('its ports', () => {
    portSuite(onASQLiteFile);
  });

  describe('a workflow it runs', () => {
    runSuite(onASQLiteFile);
  });

  describe('its waiting calls, dispatched again', () => {
    dispatchSuite(onASQLiteFile);
  });

  describe('a long run', () => {
    longRunSuite(onASQLiteFile);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(onASQLiteFile);
  });

  describe('the reactions of its playbooks', () => {
    reactionSuite(onASQLiteFile);
    movedReactionsSuite(onASQLiteFile);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(onASQLiteFile, 'host');
  });
});
