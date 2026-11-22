import { takeCoverage } from 'node:v8';

import { lineToTheTest } from './line-to-the-test.ts';

/*
 * A runtime that does not end on SIGTERM, as a stopped or wedged one does not: it says it was asked, and stays until
 * SIGKILL. It speaks on a connection to its test, which keeps it alive, so nothing in it runs on a clock, and on which
 * nothing it says can go unseen, as a change to a watched folder can. SIGKILL leaves a process no time to write its
 * coverage, so it hands it over when it was asked, before it says so, since the test kills it once it said.
 */
const toTheTest = lineToTheTest();

process.on('SIGTERM', () => {
  takeCoverage();
  toTheTest.write('sigterm\n');
});

toTheTest.write('started\n');
