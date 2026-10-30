import { pathToFileURL } from 'node:url';

import { Schema } from 'effect';

const serverEntry = Schema.decodeUnknownSync(Schema.String)(process.argv[2]);

process.stdin.once('end', () => {
  process.emit('SIGTERM', 'SIGTERM');
});
process.stdin.resume().unref();

await import(pathToFileURL(serverEntry).href);
