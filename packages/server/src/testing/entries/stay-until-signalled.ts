import { writeFileSync } from 'node:fs';

import { Function } from 'effect';

const staying = setInterval(Function.constVoid, 60_000);

process.once('SIGTERM', () => {
  clearInterval(staying);
});

writeFileSync('started.json', JSON.stringify({ arguments: process.argv.slice(2), directory: process.cwd() }));
