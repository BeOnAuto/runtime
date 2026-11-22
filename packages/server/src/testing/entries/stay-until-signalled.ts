import { writeFileSync } from 'node:fs';

import { lineToTheTest } from './line-to-the-test.ts';

/*
 * Its connection to its test keeps the process alive until SIGTERM, so nothing in it runs on a clock; it says on it
 * that it started, once it wrote what it was started with.
 */
const toTheTest = lineToTheTest();

process.once('SIGTERM', () => {
  toTheTest.destroy();
});

writeFileSync('started.json', JSON.stringify({ arguments: process.argv.slice(2), directory: process.cwd() }));
toTheTest.write('started\n');
