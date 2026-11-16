import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { shippedToolsFile, shippedToolsText } from './src/testing/shipped-additions.ts';

writeFileSync(shippedToolsFile, await shippedToolsText());
process.stdout.write(`Wrote ${fileURLToPath(shippedToolsFile)}\n`);
