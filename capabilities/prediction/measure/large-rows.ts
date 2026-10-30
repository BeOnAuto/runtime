import { writeFileSync } from 'node:fs';

import { widestRowsText } from './model-files.ts';

const [path = ''] = process.argv.slice(2);
writeFileSync(path, widestRowsText());
