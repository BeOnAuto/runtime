import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { shippedCredentialsFile, shippedCredentialsText } from './src/testing/shipped-additions.ts';

writeFileSync(shippedCredentialsFile, shippedCredentialsText());
process.stdout.write(`Wrote ${fileURLToPath(shippedCredentialsFile)}\n`);
